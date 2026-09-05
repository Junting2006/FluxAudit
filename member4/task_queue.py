"""
FluxAudit（流审）· 成员4 任务状态与流式分发
=================================================================
内存版任务存储 + 订阅式 SSE 分发（演示足够；可替换为 Redis / DB）。

设计要点：
- tasks[task_id].entries：所有已产生日志，供"迟到订阅者"重放，保证 SSE 不丢步骤。
- subscribers[task_id]：在线 SSE 连接对应的 asyncio.Queue 集合，实现 fan-out。
- finish() 向每个队列投入 None 哨兵，SSE 生成器据此结束。
"""

import asyncio
import time
from enum import Enum


class TaskStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class TaskStore:
    def __init__(self):
        self.tasks = {}
        self.subscribers = {}  # task_id -> set[asyncio.Queue]

    def create(self, task_id: str, input_data: dict) -> dict:
        self.tasks[task_id] = {
            "task_id": task_id,
            "status": TaskStatus.PENDING,
            "created_at": int(time.time()),
            "input": input_data,
            "entries": [],   # 已产生的 SSE 日志（用于迟到订阅者重放）
            "report": None,
        }
        return self.tasks[task_id]

    def get(self, task_id: str):
        return self.tasks.get(task_id)

    def set_status(self, task_id: str, status: TaskStatus):
        if task_id in self.tasks:
            self.tasks[task_id]["status"] = status

    def set_report(self, task_id: str, report: dict):
        if task_id in self.tasks:
            self.tasks[task_id]["report"] = report

    def publish(self, task_id: str, entry: dict):
        """记录日志并向所有在线订阅者推送。"""
        rec = self.tasks.get(task_id)
        if rec is None:
            return
        rec["entries"].append(entry)
        for q in list(self.subscribers.get(task_id, ())):
            q.put_nowait(entry)

    def subscribe(self, task_id: str) -> asyncio.Queue:
        q = asyncio.Queue()
        rec = self.tasks.get(task_id)
        if rec is None or rec["status"] in (TaskStatus.COMPLETED, TaskStatus.FAILED):
            q.put_nowait(None)
        else:
            self.subscribers.setdefault(task_id, set()).add(q)
        return q

    def finish(self, task_id: str):
        for q in list(self.subscribers.get(task_id, ())):
            q.put_nowait(None)  # 哨兵
        self.subscribers.pop(task_id, None)


# 单例（演示用进程内共享）
store = TaskStore()
