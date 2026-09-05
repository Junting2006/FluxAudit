# FluxAudit LICENSE 与第三方资产说明

最后更新：2026-09-04

## 一、项目代码

Hackathon 演示代码建议采用 MIT License 或 Apache-2.0 License。最终提交前由全组确认一种 license，并在仓库根目录放置 LICENSE 文件。

## 二、Python 依赖

| 依赖 | 用途 | 说明 |
|---|---|---|
| fastapi | 后端 REST API / SSE 服务 | 成员4使用 |
| uvicorn | 本地启动 FastAPI 服务 | 成员4使用 |
| pycryptodome | Ethereum keccak256 哈希 | 成员3/4必须使用，避免 SHA3 口径不一致 |
| requests | Etherscan API 请求 | 成员4使用 |
| httpx | FastAPI 测试客户端依赖 | 成员4测试使用 |
| openai | DeepSeek OpenAI-compatible API 调用 | 成员3可选使用 |

## 三、链上与 API 服务

- Etherscan / Sepolia Etherscan：用于读取公开合约源码与链上信息。
- Alchemy RPC：可用于扩展读取链上交易与合约状态。
- DeepSeek API：可选用于 DocAgent 文档解析；启用时需披露云端依赖与数据出境。

## 四、测试数据

NovaPay 与 AtlasIndex 均为成员1构造的公开 / 合成 / 已脱敏演示数据，不代表真实项目，不涉及真实资金。

## 五、安全要求

- .env、API Key、私钥、助记词不得进入仓库、PPT、录屏或提交材料。
- 提交前需要执行 secret scan。
- 如使用第三方模板、图片、音频或赛前资产，需要在本文件继续补充来源、license 和用途。
