#!/usr/bin/env python3
"""Cross-platform one-click launcher for the FluxAudit local test flow."""

import atexit
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser


RELEASE_ID = "adf92ea"
VENDORED_SDK_SHA256 = "fe2bc941422961c85e47207eb9c1d564cb425f7a3f7dab63ff8b1bc7ab0c1f9e"
BACKEND_PORT = 8000
FRONTEND_PORT = 4173
FRONTEND_URL = f"http://127.0.0.1:{FRONTEND_PORT}/"
HEALTH_URL = f"http://127.0.0.1:{BACKEND_PORT}/api/v1/health"

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / ".runtime"
BACKEND = ROOT / "member4"
MEMBER3 = ROOT / "member3"
FRONTEND = ROOT / "frontend"
PROCESSES = []
DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class LaunchError(RuntimeError):
    pass


def info(message):
    print(f"[FluxAudit] {message}", flush=True)


def require_file(path):
    if not path.is_file():
        raise LaunchError(f"文件包不完整，缺少：{path.relative_to(ROOT)}")


def hash_files(paths):
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def stamp_matches(path, expected):
    try:
        return path.read_text(encoding="utf-8").strip() == expected
    except OSError:
        return False


def run_checked(command, cwd, label):
    info(label)
    try:
        subprocess.run(command, cwd=str(cwd), check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise LaunchError(
            f"{label}失败。首次安装依赖需要联网，请检查网络后重新运行。"
        ) from exc


def port_is_open(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.25)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def process_options():
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def stop_process(process):
    if process is None or process.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (OSError, ProcessLookupError):
        pass


def cleanup():
    while PROCESSES:
        stop_process(PROCESSES.pop())


atexit.register(cleanup)


def request_shutdown(_signum, _frame):
    raise KeyboardInterrupt


for signal_name in ("SIGTERM", "SIGHUP", "SIGBREAK"):
    shutdown_signal = getattr(signal, signal_name, None)
    if shutdown_signal is not None:
        signal.signal(shutdown_signal, request_shutdown)


def wait_for_health(process, timeout=45):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise LaunchError(f"后端启动失败，退出码：{process.returncode}")
        try:
            with DIRECT_OPENER.open(HEALTH_URL, timeout=1) as response:
                payload = json.load(response)
            if (
                payload.get("status") == "ok"
                and payload.get("member3_connected") is True
                and payload.get("use_mock_data") is True
            ):
                return
            raise LaunchError(
                "后端健康状态不符合本地组测要求：需要 member3_connected=true 且 use_mock_data=true"
            )
        except LaunchError:
            raise
        except Exception as exc:
            last_error = exc
            time.sleep(0.25)
    raise LaunchError(f"后端在 {timeout} 秒内未就绪：{last_error}")


def wait_for_frontend(process, timeout=45):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise LaunchError(f"前端启动失败，退出码：{process.returncode}")
        try:
            with DIRECT_OPENER.open(FRONTEND_URL, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception as exc:
            last_error = exc
            time.sleep(0.25)
    raise LaunchError(f"前端在 {timeout} 秒内未就绪：{last_error}")


def validate_environment():
    if sys.version_info < (3, 10):
        raise LaunchError(
            f"需要 Python >= 3.10，当前为 {sys.version.split()[0]}。请升级后重试。"
        )

    node = shutil.which("node")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm") or shutil.which("npm")
    if not node or not npm:
        raise LaunchError("未找到 Node.js/npm。请安装 Node.js >= 22.13 后重试。")

    try:
        version_text = subprocess.check_output(
            [node, "-p", "process.versions.node"], text=True
        ).strip()
        version = tuple(int(part) for part in version_text.split(".")[:3])
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        raise LaunchError("无法读取 Node.js 版本。") from exc
    if version < (22, 13, 0):
        raise LaunchError(f"需要 Node.js >= 22.13，当前为 {version_text}。")

    required = [
        BACKEND / "app.py",
        BACKEND / "requirements.lock.txt",
        MEMBER3 / "agent_process.py",
        FRONTEND / "package.json",
        FRONTEND / "package-lock.json",
        FRONTEND / "vendor" / "fluxaudit-member5-web3-0.2.0.tgz",
    ]
    for path in required:
        require_file(path)

    vendored_sdk = FRONTEND / "vendor" / "fluxaudit-member5-web3-0.2.0.tgz"
    actual_sdk_sha256 = hashlib.sha256(vendored_sdk.read_bytes()).hexdigest()
    if actual_sdk_sha256 != VENDORED_SDK_SHA256:
        raise LaunchError("member5 SDK 文件校验失败，请重新获取完整测试包。")

    for port in (BACKEND_PORT, FRONTEND_PORT):
        if port_is_open(port):
            raise LaunchError(
                f"端口 {port} 已被占用。请先关闭占用它的程序，再重新启动；启动器不会结束其他进程。"
            )
    return node, npm


def python_dependencies_ready(venv_python):
    if not venv_python.is_file():
        return False
    smoke = "import fastapi, uvicorn, Crypto, httpx, requests, dotenv"
    result = subprocess.run(
        [str(venv_python), "-c", smoke],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def prepare_python():
    venv_dir = RUNTIME / "venv"
    venv_python = venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not venv_python.is_file():
        info("首次运行：创建隔离的 Python 环境…")
        try:
            subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True)
        except (OSError, subprocess.CalledProcessError) as exc:
            raise LaunchError(
                "无法创建 Python 虚拟环境。Linux 用户请确认已安装 python3-venv。"
            ) from exc

    requirements = BACKEND / "requirements.lock.txt"
    expected = hash_files([requirements])
    stamp = RUNTIME / "python-deps.sha256"
    if not stamp_matches(stamp, expected) or not python_dependencies_ready(venv_python):
        run_checked(
            [
                str(venv_python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--cache-dir",
                str(RUNTIME / "pip-cache"),
                "-r",
                str(requirements),
            ],
            ROOT,
            "安装 Python 依赖…",
        )
        stamp.write_text(expected + "\n", encoding="utf-8")
    else:
        info("Python 依赖已就绪。")
    return venv_python


def frontend_dependencies_ready(node):
    if not (FRONTEND / "node_modules").is_dir():
        return False
    smoke = (
        "await Promise.all([import('vite'), import('react'), "
        "import('@fluxaudit/member5-web3')])"
    )
    result = subprocess.run(
        [node, "--input-type=module", "-e", smoke],
        cwd=str(FRONTEND),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def prepare_frontend(node, npm):
    lockfile = FRONTEND / "package-lock.json"
    vendored_sdk = FRONTEND / "vendor" / "fluxaudit-member5-web3-0.2.0.tgz"
    expected = hash_files([lockfile, vendored_sdk])
    stamp = RUNTIME / "frontend-deps.sha256"
    if not stamp_matches(stamp, expected) or not frontend_dependencies_ready(node):
        run_checked(
            [npm, "ci", "--cache", str(RUNTIME / "npm-cache")],
            FRONTEND,
            "安装前端锁定依赖…",
        )
        stamp.write_text(expected + "\n", encoding="utf-8")
    else:
        info("前端依赖已就绪。")


def start_services(venv_python, npm):
    backend_env = os.environ.copy()
    for key in (
        "DEEPSEEK_API_KEY",
        "ETHERSCAN_API_KEY",
        "ALCHEMY_API_KEY",
        "ALCHEMY_RPC_URL",
    ):
        backend_env[key] = ""
    backend_env.update(
        {
            "USE_MOCK_DATA": "true",
            "USE_LLM": "false",
            "PORT": str(BACKEND_PORT),
            "MEMBER3_PATH": str(MEMBER3),
        }
    )

    frontend_env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("VITE_")
    }
    frontend_env.update(
        {
            "VITE_FLUXAUDIT_CHAIN_ID": "11155111",
            "VITE_FLUXAUDIT_CONTRACT_ADDRESS": "",
            "VITE_FLUXAUDIT_TRUSTED_AUDITOR": "",
            "VITE_SEPOLIA_RPC_URL": "",
        }
    )

    info("启动本地后端（仅绑定 127.0.0.1）…")
    backend_process = subprocess.Popen(
        [
            str(venv_python),
            "-m",
            "uvicorn",
            "app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(BACKEND_PORT),
        ],
        cwd=str(BACKEND),
        env=backend_env,
        **process_options(),
    )
    PROCESSES.append(backend_process)
    wait_for_health(backend_process)
    info("后端健康检查通过：member3 已连接，Mock 模式已开启。")

    info("启动产品前端（固定端口 4173）…")
    frontend_process = subprocess.Popen(
        [
            npm,
            "run",
            "dev",
            "--",
            "--host",
            "127.0.0.1",
            "--port",
            str(FRONTEND_PORT),
            "--strictPort",
        ],
        cwd=str(FRONTEND),
        env=frontend_env,
        **process_options(),
    )
    PROCESSES.append(frontend_process)
    wait_for_frontend(frontend_process)
    return backend_process, frontend_process


def main():
    info(f"组内测试版 {RELEASE_ID} 启动器")
    RUNTIME.mkdir(parents=True, exist_ok=True)
    node, npm = validate_environment()
    venv_python = prepare_python()
    prepare_frontend(node, npm)
    backend_process, frontend_process = start_services(venv_python, npm)

    print("\n" + "=" * 64)
    info(f"已就绪：{FRONTEND_URL}")
    info("请测试 NovaPay、AtlasIndex、报告下载和篡改验伪。")
    info("Sepolia 显示 NOT CONFIGURED 是当前版本的预期结果。")
    info("保持此窗口开启；按 Ctrl+C 会同时安全停止前后端。")
    print("=" * 64 + "\n", flush=True)

    if os.getenv("FLUXAUDIT_NO_BROWSER") == "1":
        info("自动打开浏览器已被测试模式关闭。")
    else:
        try:
            if not webbrowser.open(FRONTEND_URL, new=2):
                info("未能自动打开浏览器，请手动访问上面的地址。")
        except Exception:
            info("未能自动打开浏览器，请手动访问上面的地址。")

    while True:
        if backend_process.poll() is not None:
            raise LaunchError(f"后端意外退出，退出码：{backend_process.returncode}")
        if frontend_process.poll() is not None:
            raise LaunchError(f"前端意外退出，退出码：{frontend_process.returncode}")
        time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        info("正在停止前后端…")
        sys.exit(0)
    except LaunchError as exc:
        print(f"\n[FluxAudit] 启动失败：{exc}", file=sys.stderr, flush=True)
        sys.exit(1)
    except OSError as exc:
        print(
            "\n[FluxAudit] 启动失败：无法写入运行目录。"
            "请完整解压到可写目录，并检查磁盘空间和文件权限。"
            f"（{exc}）",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)
