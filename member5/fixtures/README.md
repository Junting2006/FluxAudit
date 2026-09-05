# Fixture provenance

seven-step-report.json / golden-report.json：2026-09-05 在本机运行成员 4 process_task，调用工作区 member3.agent_process.run_agent_process 生成。NovaPay 合成链上数据，use_llm=false，85/HIGH，完整七步。报告哈希固定为 0x98265bfbf5ba86ba364be6f52801db3ca058b66cffa938c9f811e6286050df95。

fractional-report.json：同一路径，“团队持有 10% 代币，锁仓 6 个月。”，包含 lockup_years=0.5；70/HIGH。

tampered-report.json：复制 golden 后仅把 summary.overall_risk_score 从85改为10，故报告哈希和清单均不一致。

legacy-report.json：SDK 0.1.1 的旧三步报告，只用于新版拒绝测试。

python-number-vectors.json：成员 4 hashing.canonical_json 生成，覆盖负零、整数型浮点、小数、指数与次正规数。生产测试报告与数字向量均来自 Python，不由待测 SDK 生成。

以上样例不是已在 Sepolia 登记的报告，不含真实付费 API 调用。不得展示为真实链上数据。
