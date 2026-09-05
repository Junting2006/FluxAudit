"""
FluxAudit（流审）· 成员4 适配层：调用成员3 的 run_agent_process
=================================================================
成员3 交付了 agent_process.run_agent_process(input_data)，输入：
    {task_id, whitepaper_text, chain_data}
输出字段与分工.md /api/v1/audit/report 一一对应。

成员4 的职责边界：
- 负责传入 chain_data（来自 ChainAgent）；
- 负责组合成最终报告 + 完成哈希（report_builder）；
- 不重写 AI 逻辑，只在成员3 不可用时回退到 Mock（仅限 USE_MOCK_DATA 模式）。

仓库约定（总集成负责人维护）：
    fluxaudit/
    ├── member3/agent_process.py      # 成员3 交付
    └── member4/...                   # 本交付物
可用环境变量 MEMBER3_PATH 指向任意位置的 member3 目录。
"""

import importlib
import os
import sys

from config import MEMBER3_PATH, USE_MOCK_DATA


def _add_to_path(path: str):
    """把"可导入 member3 包"的目录加入 sys.path（兼容指向 member3 文件夹或其父目录）。"""
    if not path:
        return
    if os.path.isfile(os.path.join(path, "agent_process.py")):
        # path 直接就是 member3 文件夹
        parent = os.path.dirname(os.path.abspath(path))
    else:
        # path 是包含 member3/ 的父目录
        parent = os.path.abspath(path)
    if parent and parent not in sys.path:
        sys.path.insert(0, parent)


def _resolve_member3():
    """返回成员3 的 run_agent_process 函数，找不到返回 None。"""
    here = os.path.dirname(os.path.abspath(__file__))
    # 候选目录（member3 文件夹本身，或它的父目录）
    candidates = []
    if MEMBER3_PATH:
        candidates.append(MEMBER3_PATH)
    candidates.append(os.path.join(here, "..", "member3"))   # 同级 member3
    candidates.append(os.path.join(here, "vendor", "member3"))  # vendor/member3
    for path in candidates:
        _add_to_path(path)
    try:
        from member3.agent_process import run_agent_process  # noqa: F401
        return run_agent_process
    except Exception:
        return None


RUN_AGENT_PROCESS = _resolve_member3()


def get_agent_result(task_id: str, whitepaper_text: str, chain_data: dict,
                     use_llm: bool = False) -> dict:
    """
    统一入口：返回与成员3 run_agent_process 完全一致结构的字典。
    成员3 不可用时，回退到 Mock Agent（仅限 USE_MOCK_DATA 模式）。
    """
    if RUN_AGENT_PROCESS is not None:
        return RUN_AGENT_PROCESS({
            "task_id": task_id,
            "whitepaper_text": whitepaper_text,
            "chain_data": chain_data,
            "use_llm": use_llm,
        })
    if not USE_MOCK_DATA:
        raise RuntimeError(
            "成员3 agent_process 未找到，且未开启 USE_MOCK_DATA。"
            "请将 member3/ 放在本包同级目录，或设置 MEMBER3_PATH / USE_MOCK_DATA=true。"
        )
    from mock_fallback import run_mock_agent
    return run_mock_agent(task_id, whitepaper_text, chain_data)
