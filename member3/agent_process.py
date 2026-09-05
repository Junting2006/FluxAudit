"""
FluxAudit（流审）· 成员3交付物
AI 多智能体链上尽调：DocAgent -> CrossCheckAgent -> RiskAgent

设计要点：
1. 默认使用确定性规则引擎，无 LLM Key 也能 100% 跑通 Demo（USE_LLM 可切换）。
2. reasoning_log 每一步生成链式 step_hash：H_i = keccak256(H_{i-1} || content_i || timestamp_ms_i)。
3. 输出结构与分工.md 中 /api/v1/audit/report 的字段一一对应，供成员4直接映射。

运行方式：
    python agent_process.py

必需依赖（用于与 ethers.js keccak256 完全一致的哈希口径）：
    pip install pycryptodome
未安装时会 fail-fast，避免生成和前端/合约不一致的 step_hash。
"""

import json
import os
import re
import time
from typing import Any, Dict, List, Optional

try:
    from .config import (
        DOC_LAG_RISK_WEIGHT,
        HIGH_YIELD_THRESHOLD,
        LLM_MAX_RETRIES,
        LLM_RETRY_BACKOFF_SECONDS,
        LLM_TIMEOUT_SECONDS,
    )
except ImportError:  # 支持直接运行：python agent_process.py
    from config import (
        DOC_LAG_RISK_WEIGHT,
        HIGH_YIELD_THRESHOLD,
        LLM_MAX_RETRIES,
        LLM_RETRY_BACKOFF_SECONDS,
        LLM_TIMEOUT_SECONDS,
    )

# ---------------------------------------------------------------
# 哈希工具（与成员5对齐口径：以太坊 keccak256）
# ---------------------------------------------------------------
try:
    from Crypto.Hash import keccak

    def keccak256(data: bytes) -> bytes:
        k = keccak.new(digest_bits=256)
        k.update(data)
        return k.digest()

except ImportError:
    raise RuntimeError(
        "FluxAudit 需要 pycryptodome 以生成与 ethers.js 一致的 keccak256，"
        "请执行: pip install pycryptodome"
    )


USE_LLM = os.getenv("USE_LLM", "false").lower() in ("1", "true", "yes")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

# 无 chain_data 时的 Mock 兜底（对应分工.md 的 USE_MOCK_DATA 思想）
MOCK_CHAIN_DATA: Dict[str, Any] = {
    "team_wallet_pct": 82,
    "top_wallet_concentration_pct": 82,
    "has_timelock": False,
    "contract_verified": True,
    "liquidity_locked": False,
    "source_similarity_pct": 92,
    "audit_report_available": False,
    "abnormal_fund_flow": True,
    "demo_profile": "novapay_high_risk",
}

DISCLAIMER = "本报告由 FluxAudit 辅助诊断生成，基于测试与公开数据，不构成财务投资建议。"


def _build_deepseek_prompt(whitepaper_text: str, chain_data: Dict[str, Any]) -> str:
    return f"""
你是 FluxAudit 的 DocAgent，负责从 Web3 项目文档中提取可验证声明。

任务：
从项目文档中提取团队代币占比、锁仓/vesting、审计声明、高收益承诺等字段。

严格要求：
- 只返回 JSON，不要 Markdown，不要解释性段落。
- 只根据项目文档提取，不要使用链上数据编造文档声明。
- 缺失信息用 null 或 false。
- 不提供投资建议。
- statements 数组中的每一项应包含 field、value 或 value_pct/value_years、raw_snippet。

返回 JSON 格式：
{{
  "doc_result": {{
    "team_allocation_pct": 10,
    "has_lockup_claim": true,
    "lockup_years": 2,
    "audit_claimed": true,
    "audit_firm": "certik",
    "high_yield_promise": true,
    "yield_pct": 30,
    "statements": []
  }}
}}

项目文档：
{whitepaper_text}
""".strip()


def _call_deepseek_once(whitepaper_text: str, chain_data: Dict[str, Any]) -> Dict[str, Any]:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is not set")

    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("openai package is not installed. Run: pip install openai") from exc

    # 关闭 SDK 内置重试，统一由下面的有限重试逻辑控制总等待时间。
    client = OpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL, max_retries=0)
    response = client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=[
            {
                "role": "system",
                "content": "You are a strict JSON-only Web3 audit agent. Return valid JSON only.",
            },
            {"role": "user", "content": _build_deepseek_prompt(whitepaper_text, chain_data)},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        timeout=LLM_TIMEOUT_SECONDS,
    )
    content = response.choices[0].message.content or "{}"
    return json.loads(content)


def _call_deepseek_json(whitepaper_text: str, chain_data: Dict[str, Any]) -> Dict[str, Any]:
    """有限重试的 LLM 调用；失败后由上层自动回退规则引擎。"""
    last_error: Optional[Exception] = None
    for attempt in range(LLM_MAX_RETRIES + 1):
        try:
            return _call_deepseek_once(whitepaper_text, chain_data)
        except Exception as exc:
            last_error = exc
            if attempt < LLM_MAX_RETRIES:
                delay = LLM_RETRY_BACKOFF_SECONDS * (2 ** attempt)
                time.sleep(delay)

    raise RuntimeError(
        f"DeepSeek failed after {LLM_MAX_RETRIES + 1} attempt(s), "
        f"timeout={LLM_TIMEOUT_SECONDS}s: {last_error}"
    ) from last_error


def _score_to_level(score: int) -> str:
    if score < 30:
        return "LOW"
    if score < 60:
        return "MEDIUM"
    if score < 90:
        return "HIGH"
    return "CRITICAL"


def _normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    return bool(value)


def _normalize_pct(value: Any) -> Optional[int]:
    if value is None or value == "UNKNOWN":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _normalize_doc_result(raw_doc: Dict[str, Any]) -> Dict[str, Any]:
    statements = raw_doc.get("statements") or []
    if not isinstance(statements, list):
        statements = []

    lockup_years = raw_doc.get("lockup_years")
    try:
        lockup_years = None if lockup_years in (None, "UNKNOWN") else float(lockup_years)
    except (TypeError, ValueError):
        lockup_years = None

    return {
        "team_allocation_pct": _normalize_pct(raw_doc.get("team_allocation_pct")),
        "has_lockup_claim": _normalize_bool(raw_doc.get("has_lockup_claim")),
        "lockup_years": lockup_years,
        "audit_claimed": _normalize_bool(raw_doc.get("audit_claimed")),
        "audit_firm": raw_doc.get("audit_firm"),
        "high_yield_promise": _normalize_bool(raw_doc.get("high_yield_promise")),
        "yield_pct": _normalize_pct(raw_doc.get("yield_pct")),
        "statements": statements,
    }


def _extract_doc_via_llm(whitepaper_text: str, chain_data: Dict[str, Any]) -> Dict[str, Any]:
    raw = _call_deepseek_json(whitepaper_text, chain_data)
    return _normalize_doc_result(raw.get("doc_result") or {})


# ---------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------
def _normalize_integral_floats(obj: Any) -> Any:
    """递归把 2.0 规范成 2，以匹配浏览器 JSON.parse/Stringify。"""
    if isinstance(obj, float) and obj.is_integer():
        return int(obj)
    if isinstance(obj, dict):
        return {key: _normalize_integral_floats(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_normalize_integral_floats(value) for value in obj]
    return obj


def _canonical(obj: Any) -> str:
    """规范化序列化：保证相同内容产出相同哈希。"""
    normalized = _normalize_integral_floats(obj)
    return json.dumps(normalized, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _now_ms() -> int:
    return int(time.time() * 1000)


def _hash_step(prev_hash: str, content: str, timestamp: int) -> str:
    """H_i = keccak256(H_{i-1} || content_i || timestamp_ms_i)"""
    payload = f"{prev_hash}|{content}|{timestamp}".encode("utf-8")
    return "0x" + keccak256(payload).hex()


def _find_pct(text: str, keywords: str) -> Optional[int]:
    # 先匹配紧邻的 “Team:10%” / “APR20%”，再兼容中间夹有描述文字的常见写法。
    m = re.search(
        keywords + r"(?:\s*[:：=]?\s*|[^0-9%]{0,30})(\d{1,3})\s*%",
        text,
        re.IGNORECASE,
    )
    return int(m.group(1)) if m else None


def _find_duration(text: str) -> Optional[Dict[str, Any]]:
    """提取锁仓/vesting 时长，统一换算为年。"""
    m = re.search(
        r"(lock(?:up)?|vest(?:ing)?|timelock|锁仓|锁定|解锁)"
        r"[^0-9]{0,30}(\d+)\s*(years?|months?|days?|年|个月|天)",
        text,
        re.IGNORECASE,
    )
    if not m:
        return None
    value = int(m.group(2))
    unit = m.group(3).lower()
    if unit in ("year", "years", "年"):
        years = float(value)
    elif unit in ("month", "months", "个月"):
        years = value / 12.0
    else:  # days / 天
        years = value / 365.0
    return {"value": value, "unit": unit, "years": round(years, 2), "raw": m.group(0)}


KNOWN_AUDIT_FIRMS = [
    "certik", "peckshield", "slowmist", "quantstamp", "hacken",
    "trail of bits", "consensys", "beosin", "慢雾", "派盾",
]

YIELD_PROMISE_PATTERNS = re.compile(
    r"guaranteed\s+(return|yield)|risk[- ]?free|fixed\s+(return|yield)|"
    r"本金安全|保本|收益稳定|固定收益|稳赚|无风险收益",
    re.IGNORECASE,
)

YIELD_NEGATION_PATTERNS = re.compile(
    r"不承诺.{0,8}(固定收益|收益|回报)|无收益承诺|不保证.{0,8}(收益|回报)|"
    r"no\s+guaranteed\s+(return|yield)|does\s+not\s+guarantee\s+(return|yield)",
    re.IGNORECASE,
)


# ---------------------------------------------------------------
# Agent 1: DocAgent —— 文档解析（提取项目声明）
# ---------------------------------------------------------------
def doc_agent(whitepaper_text: str) -> Dict[str, Any]:
    """
    从白皮书文本中提取可验证声明：
    团队占比、锁仓时长、审计声明、高收益承诺。
    """
    text = whitepaper_text or ""
    statements: List[Dict[str, Any]] = []

    # 1) 团队占比
    team_pct = _find_pct(text, r"(?:team|core team|founding team|founders?|团队|创始)")
    if team_pct is not None:
        statements.append({
            "field": "team_allocation",
            "value_pct": team_pct,
            "raw_snippet": f"团队/Team 占比 {team_pct}%",
        })

    # 2) 锁仓时长
    lock = _find_duration(text)
    if lock:
        statements.append({
            "field": "lockup",
            "value_years": lock["years"],
            "raw_snippet": lock["raw"],
        })

    # 3) 审计声明
    audit_claimed = bool(re.search(r"audit(?:ed)?|审计", text, re.IGNORECASE))
    audit_firm = None
    for firm in KNOWN_AUDIT_FIRMS:
        if firm in text.lower():
            audit_claimed = True
            audit_firm = firm
            break
    if audit_claimed:
        statements.append({
            "field": "audit",
            "value": True,
            "firm": audit_firm,
        })

    # 4) 高收益承诺（阈值由 config.py / HIGH_YIELD_THRESHOLD 配置）
    yield_pct = _find_pct(text, r"(?:apy|apr|annual|yield|return|年化|收益|回报)")
    has_yield_negation = bool(YIELD_NEGATION_PATTERNS.search(text))
    high_yield_promise = not has_yield_negation and (
        (yield_pct is not None and yield_pct >= HIGH_YIELD_THRESHOLD)
        or bool(YIELD_PROMISE_PATTERNS.search(text))
    )
    if yield_pct is not None:
        statements.append({
            "field": "yield_promise",
            "value_pct": yield_pct,
            "high_risk": high_yield_promise,
        })

    return {
        "team_allocation_pct": team_pct,
        "has_lockup_claim": lock is not None,
        "lockup_years": lock["years"] if lock else None,
        "audit_claimed": audit_claimed,
        "audit_firm": audit_firm,
        "high_yield_promise": high_yield_promise,
        "yield_pct": yield_pct,
        "statements": statements,
    }


# ---------------------------------------------------------------
# Agent 2: CrossCheckAgent —— 文档声明 vs 链上数据，找矛盾
# ---------------------------------------------------------------
def cross_check_agent(doc_result: Dict[str, Any], chain_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """把文档声明与链上数据对比，输出矛盾列表（findings）。"""
    contradictions: List[Dict[str, Any]] = []
    chain_data = chain_data or {}
    demo_profile = chain_data.get("demo_profile")

    # 矛盾1：团队占比不符（容忍 15 个百分点误差）
    team_doc = doc_result.get("team_allocation_pct")
    team_chain = chain_data.get("team_wallet_pct")
    if team_doc is not None and team_chain is not None and abs(team_chain - team_doc) > 15:
        severity = "CRITICAL" if team_chain >= 60 else "HIGH"
        finding = {
            "category": "TOKENOMICS_MISMATCH",
            "severity": severity,
            "title": "代币分配与智能合约逻辑矛盾",
            "description": f"文档声明团队持股 {team_doc}%，实际链上团队钱包占比 {team_chain}%。",
            "evidence": f"Whitepaper tokenomics vs chain team_wallet_pct={team_chain}",
        }
        if demo_profile == "novapay_high_risk":
            finding["risk_weight"] = 20
        contradictions.append(finding)

    # 矛盾2：文档声称锁仓，但链上无 TimeLock
    if doc_result.get("has_lockup_claim") and not chain_data.get("has_timelock", False):
        years = doc_result.get("lockup_years")
        finding = {
            "category": "TIMELOCK_MISSING" if demo_profile == "novapay_high_risk" else "LOCKUP_VIOLATION",
            "severity": "CRITICAL",
            "title": "锁仓承诺与链上合约约束矛盾",
            "description": f"文档承诺锁仓 {years} 年，但链上合约未发现 TimeLock 约束。",
            "evidence": "Whitepaper lockup claim vs chain has_timelock=False",
        }
        if demo_profile == "novapay_high_risk":
            finding["risk_weight"] = 15
        contradictions.append(finding)

    # 矛盾3：文档声称已审计，但合约未开源验证
    if doc_result.get("audit_claimed") and not chain_data.get("contract_verified", False):
        contradictions.append({
            "category": "UNVERIFIED_CONTRACT",
            "severity": "HIGH",
            "title": "审计声明与合约验证状态矛盾",
            "description": "文档声称已通过审计，但链上合约未开源验证，无法复核。",
            "evidence": "Whitepaper audit claim vs chain contract_verified=False",
        })

    # 扩展风险：文档声称已审计，但审计报告不可访问/不可下载
    if doc_result.get("audit_claimed") and chain_data.get("audit_report_available") is False:
        contradictions.append({
            "category": "MISSING_AUDIT",
            "severity": "MEDIUM",
            "title": "声称的审计报告不可验证",
            "description": "文档声称已完成审计，但未能验证公开审计报告链接或下载记录。",
            "evidence": "Whitepaper audit claim vs chain audit_report_available=False",
            "risk_weight": 5,
        })

    # 扩展风险：流动性未锁定，LP owner 仍可操作
    if chain_data.get("liquidity_locked") is False:
        lp_owner = chain_data.get("lp_owner") or "unknown"
        contradictions.append({
            "category": "LIQUIDITY_UNLOCKED",
            "severity": "CRITICAL",
            "title": "流动性池权限未锁定",
            "description": "链上数据显示初始流动性未锁定，存在撤池或转移风险。",
            "evidence": f"chain liquidity_locked=False; lp_owner={lp_owner}",
            "risk_weight": 15,
        })

    # 扩展风险：源码与高风险/已跑路项目高度相似
    similarity_pct = chain_data.get("source_similarity_pct")
    if similarity_pct is not None and similarity_pct >= 85:
        contradictions.append({
            "category": "CODE_FORKED",
            "severity": "HIGH",
            "title": "源码与高风险项目高度相似",
            "description": f"合约源码与已知高风险项目相似度约 {similarity_pct}%，需要人工复核。",
            "evidence": f"chain source_similarity_pct={similarity_pct}",
            "risk_weight": 10,
        })

    # 扩展风险：公募资金或项目资金流向异常
    if chain_data.get("abnormal_fund_flow") is True:
        target = chain_data.get("fund_flow_target") or "exchange_hot_wallet"
        contradictions.append({
            "category": "FUND_FLOW_ABNORMAL",
            "severity": "HIGH",
            "title": "资金流向异常",
            "description": "链上交易显示项目资金流向交易所热钱包或其他高风险地址。",
            "evidence": f"chain abnormal_fund_flow=True; target={target}",
            "risk_weight": 10,
        })

    # 扩展低风险：文档进度与链上开发进度不一致，但不构成重大风险
    doc_progress = chain_data.get("doc_progress_pct")
    chain_progress = chain_data.get("chain_progress_pct")
    if doc_progress is not None and chain_progress is not None and abs(chain_progress - doc_progress) >= 10:
        contradictions.append({
            "category": "DOC_LAG",
            "severity": "LOW",
            "title": "白皮书路线图进度滞后于实际开发进度",
            "description": f"文档标注开发进度约 {doc_progress}%，链上部署记录显示约 {chain_progress}%。",
            "evidence": f"doc_progress_pct={doc_progress}; chain_progress_pct={chain_progress}",
            "risk_weight": DOC_LAG_RISK_WEIGHT,
        })

    # 链上异常4：头部地址集中度过高（即使文档未声明，也作为独立发现）
    top_pct = chain_data.get("top_wallet_concentration_pct")
    suppress_wallet_concentration = chain_data.get("suppress_wallet_concentration", False)
    if not suppress_wallet_concentration and top_pct is not None and top_pct >= 60:
        severity = "CRITICAL" if top_pct >= 80 else "HIGH"
        contradictions.append({
            "category": "WALLET_CONCENTRATION",
            "severity": severity,
            "title": "链上代币高度集中",
            "description": f"头部钱包持仓占比达 {top_pct}%，存在单一实体控盘风险。",
            "evidence": f"chain top_wallet_concentration_pct={top_pct}",
        })

    return contradictions


# ---------------------------------------------------------------
# Agent 3: RiskAgent —— 综合打分
# ---------------------------------------------------------------
SEVERITY_SCORE = {"CRITICAL": 25, "HIGH": 18, "MEDIUM": 10, "LOW": 5}


def risk_agent(
    doc_result: Dict[str, Any],
    chain_data: Dict[str, Any],
    cross_check_result: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """根据矛盾与风险规则打分，输出 risk_score / risk_level / risk_reasons。"""
    score = 0
    reasons: List[str] = []

    for c in cross_check_result:
        score += int(c.get("risk_weight", SEVERITY_SCORE.get(c.get("severity"), 10)))
        title = c.get("title", "未命名矛盾")
        description = c.get("description", "")
        reasons.append(f"{title}：{description}" if description else title)

    # 高收益承诺加成
    if doc_result.get("high_yield_promise"):
        score += 10
        reasons.append(
            f"文档承诺高收益（{doc_result.get('yield_pct')}%），存在不切实际收益承诺风险。"
        )

    score = min(100, max(0, score))

    has_critical = any(c.get("severity") == "CRITICAL" for c in cross_check_result)
    if score < 30 and has_critical:
        score = 30

    level = _score_to_level(score)

    if not reasons:
        reasons.append("未检测到明显的文档-链上矛盾。")

    return {"risk_score": score, "risk_level": level, "risk_reasons": reasons}


def _build_agent_response(
    task_id: str,
    doc_result: Dict[str, Any],
    chain_data: Dict[str, Any],
    contradictions: List[Dict[str, Any]],
    risk: Dict[str, Any],
    model_version: str,
    fallback_reason: Optional[str] = None,
    initial_hash: Optional[str] = None,
) -> Dict[str, Any]:
    reasoning_log: List[Dict[str, Any]] = []
    prev_hash = initial_hash or "0x" + "0" * 64  # 默认 H_(-1) = 0x000...0

    # ---- Step 0: DocAgent ----
    ts0 = _now_ms()
    statement_count = len(doc_result.get("statements") or [])
    msg0 = f"DocAgent 完成文档解析，提取声明 {statement_count} 条。"
    h0 = _hash_step(prev_hash, _canonical(doc_result) + "|" + msg0, ts0)
    reasoning_log.append({
        "agent": "DocAgent",
        "current_step": "DOC_PARSING",
        "message": msg0,
        "timestamp": ts0,
        "step_index": 0,
        "step_hash": h0,
        "output": doc_result,
    })

    # ---- Step 1: CrossCheckAgent ----
    ts1 = _now_ms()
    msg1 = f"CrossCheckAgent 完成文档-链上交叉核验，发现矛盾 {len(contradictions)} 条。"
    h1 = _hash_step(h0, _canonical(contradictions) + "|" + msg1, ts1)
    reasoning_log.append({
        "agent": "CrossCheckAgent",
        "current_step": "CROSS_CHECKING",
        "message": msg1,
        "timestamp": ts1,
        "step_index": 1,
        "step_hash": h1,
        "output": contradictions,
    })

    # ---- Step 2: RiskAgent ----
    ts2 = _now_ms()
    msg2 = f"RiskAgent 综合打分：{risk['risk_score']} 分，风险等级 {risk['risk_level']}。"
    h2 = _hash_step(h1, _canonical(risk) + "|" + msg2, ts2)
    reasoning_log.append({
        "agent": "RiskAgent",
        "current_step": "RISK_SCORING",
        "message": msg2,
        "timestamp": ts2,
        "step_index": 2,
        "step_hash": h2,
        "output": risk,
    })

    meta = {
        "model_version": model_version,
        "timestamp": ts2,
    }
    if fallback_reason:
        meta["fallback_reason"] = fallback_reason

    step_hashes = [entry["step_hash"] for entry in reasoning_log]

    return {
        "task_id": task_id,
        "current_step": "RISK_SCORING",
        "meta": meta,
        "risk_score": risk["risk_score"],
        "risk_level": risk["risk_level"],
        "risk_reasons": risk["risk_reasons"],
        "contradictions": contradictions,
        "reasoning_log": reasoning_log,
        "step_hashes": step_hashes,
        "doc_result": doc_result,
        "chain_data_used": chain_data,
        "disclaimer": DISCLAIMER,
    }


# ---------------------------------------------------------------
# 编排入口：run_agent_process —— 成员4唯一需要调用的函数
# ---------------------------------------------------------------
def run_agent_process(input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    入参（成员4约定）：
        {
          "task_id": "task_demo_001",
          "whitepaper_text": "...",
          "chain_data": { team_wallet_pct, top_wallet_concentration_pct,
                          has_timelock, contract_verified }
        }

    出参：包含 risk_score / risk_level / risk_reasons / contradictions /
          reasoning_log / step_hashes / doc_result / chain_data_used / current_step。
    可选入参：
        use_llm: bool，按单个任务覆盖环境变量 USE_LLM。
    """
    task_id = input_data.get("task_id", "task_unknown")
    whitepaper_text = input_data.get("whitepaper_text") or ""
    chain_data = input_data.get("chain_data") or MOCK_CHAIN_DATA
    initial_hash = input_data.get("initial_hash")
    use_llm = input_data.get("use_llm", USE_LLM)
    if isinstance(use_llm, str):
        use_llm = use_llm.strip().lower() in {"1", "true", "yes", "y"}

    model_version = "FluxAudit-RuleEngine-v1"
    fallback_reason = None
    doc_result = doc_agent(whitepaper_text)

    if use_llm:
        try:
            doc_result = _extract_doc_via_llm(whitepaper_text, chain_data)
            model_version = f"DeepSeek-{DEEPSEEK_MODEL}+RuleEngine"
        except Exception as exc:
            fallback_reason = f"DeepSeek unavailable: {exc}"

    # 交叉校验与打分始终走确定性规则，保证链上硬指标不丢、可解释、可验证。
    contradictions = cross_check_agent(doc_result, chain_data)
    risk = risk_agent(doc_result, chain_data, contradictions)
    return _build_agent_response(
        task_id=task_id,
        doc_result=doc_result,
        chain_data=chain_data,
        contradictions=contradictions,
        risk=risk,
        model_version=model_version,
        fallback_reason=fallback_reason,
        initial_hash=initial_hash,
    )


# ---------------------------------------------------------------
# Demo：两套测试数据（高风险 / 合规），运行后即产出“输出样例”
# ---------------------------------------------------------------
if __name__ == "__main__":
    HIGH_RISK_CASE = {
        "task_id": "task_demo_001",
        "whitepaper_text": (
            "Project XYZ 白皮书 v1.0：团队持有 10% 代币，锁仓 2 年。"
            "已由 CertiK 完成安全审计。预计 APY 30%，收益稳定。"
        ),
        "chain_data": {
            "team_wallet_pct": 82,
            "top_wallet_concentration_pct": 82,
            "has_timelock": False,
            "contract_verified": False,
        },
    }

    COMPLIANT_CASE = {
        "task_id": "task_atlas_demo",
        "whitepaper_text": (
            "Atlas Index 白皮书：团队 15%，锁仓 12 个月，链上 TimeLock 可查。"
            "已通过 SlowMist 审计，不承诺固定收益。"
        ),
        "chain_data": {
            "team_wallet_pct": 15,
            "top_wallet_concentration_pct": 30,
            "has_timelock": True,
            "contract_verified": True,
            "liquidity_locked": True,
            "audit_report_available": True,
            "abnormal_fund_flow": False,
            "doc_progress_pct": 60,
            "chain_progress_pct": 75,
            "demo_profile": "atlas_low_risk",
        },
    }

    print("=" * 70)
    print("FluxAudit Agent Process Demo")
    print("=" * 70)

    print("\n[Case 1] 高风险项目输出样例（直接复制给成员4作契约）：")
    result1 = run_agent_process(HIGH_RISK_CASE)
    print(json.dumps(result1, indent=2, ensure_ascii=False))

    print("\n" + "=" * 70)
    print("[Case 2] 合规项目输出样例：")
    result2 = run_agent_process(COMPLIANT_CASE)
    print(json.dumps(result2, indent=2, ensure_ascii=False))
