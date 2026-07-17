import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent

STOP_REASON_EMOJI = {
    "end_turn": "✅",
    "tool_use": "🔧",
    "max_tokens": "⚠️",
    "stop_sequence": "🛑",
}


def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


def fmt_tokens(n: int) -> str:
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


def md_to_html(text: str) -> str:
    """Convert basic Markdown to Telegram HTML."""
    t = html.escape(text)

    stash: dict[str, str] = {}
    idx = [0]

    def save(tag: str) -> str:
        key = f"\x00{idx[0]}\x00"
        idx[0] += 1
        stash[key] = tag
        return key

    t = re.sub(r"```[^\n]*\n?(.*?)```", lambda m: save(f"<code>{m.group(1).strip()}</code>"), t, flags=re.DOTALL)
    t = re.sub(r"`([^`\n]+)`", lambda m: save(f"<code>{m.group(1)}</code>"), t)

    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"__(.+?)__", r"<b>\1</b>", t)
    t = re.sub(r"(?<!\*)\*(?!\*)([^*\n]+)(?<!\*)\*(?!\*)", r"<i>\1</i>", t)
    t = re.sub(r"(?<!_)_(?!_)([^_\n]+)(?<!_)_(?!_)", r"<i>\1</i>", t)

    t = re.sub(r"^#{1,6}\s+", "", t, flags=re.MULTILINE)

    for key, val in stash.items():
        t = t.replace(key, val)

    return t


def extract_transcript_info(transcript_path: str) -> dict:
    path = Path(transcript_path)
    if not path.exists():
        return {}

    result: dict = {}
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return {}

    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue

        obj_type = obj.get("type")

        if obj_type == "ai-title" and "ai_title" not in result:
            result["ai_title"] = obj.get("aiTitle", "")

        if obj_type == "assistant" and "last_text" not in result:
            msg = obj.get("message", {})
            for block in msg.get("content", []):
                if block.get("type") == "text":
                    result["last_text"] = block["text"].strip()
                    break
            if "stop_reason" not in result:
                sr = msg.get("stop_reason")
                if sr:
                    result["stop_reason"] = sr
            if "usage" not in result:
                usage = msg.get("usage")
                if usage:
                    result["usage"] = usage

        if "ai_title" in result and "last_text" in result and "usage" in result:
            break

    return result


def send_telegram(token: str, chat_id: str, text: str) -> None:
    payload = json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "HTML"}).encode()
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=8)


def build_stop_message(data: dict, info: dict) -> str:
    cwd = data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or ""
    project_name = Path(cwd).name if cwd else "—"

    stop_reason = info.get("stop_reason") or data.get("stop_reason") or "end_turn"
    reason_text = data.get("reason") or stop_reason
    emoji = STOP_REASON_EMOJI.get(stop_reason, "❓")

    now = datetime.now()
    time_str = f"{now.strftime('%H:%M')} · {now.strftime('%d.%m.%Y')}"

    lines = ["🤖 <b>Claude Code</b>"]

    ai_title = info.get("ai_title")
    if ai_title:
        lines.append(f"\n📌 <b>{html.escape(ai_title)}</b>")

    lines.append(f"\n📁 <code>{html.escape(project_name)}</code>")
    lines.append(f"🕐 {time_str}")
    lines.append(f"{emoji} {html.escape(reason_text)}")

    last_text = info.get("last_text")
    if last_text:
        preview = last_text[:300] + ("…" if len(last_text) > 300 else "")
        lines.append("\n💬 <i>Итог:</i>")
        lines.append(f"<blockquote>{md_to_html(preview)}</blockquote>")

    usage = info.get("usage")
    if usage:
        inp = usage.get("input_tokens", 0)
        out = usage.get("output_tokens", 0)
        cache = usage.get("cache_read_input_tokens", 0)
        stats = f"↑{fmt_tokens(inp)}  ↓{fmt_tokens(out)}"
        if cache:
            stats += f"  🔄{fmt_tokens(cache)} кэш"
        lines.append(f"\n📊 {stats}")

    return "\n".join(lines)


def build_notification_message(data: dict) -> str:
    cwd = data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or ""
    project_name = Path(cwd).name if cwd else "—"
    now = datetime.now().strftime("%H:%M · %d.%m.%Y")

    msg = (
        data.get("message")
        or data.get("title")
        or data.get("reason")
        or "Требуется ваше внимание"
    )

    lines = [
        "🔔 <b>Claude Code</b>",
        f"\n📁 <code>{html.escape(project_name)}</code>",
        f"🕐 {now}",
        f"\n💬 {html.escape(msg)}",
    ]
    return "\n".join(lines)


def main() -> None:
    env = load_env(SCRIPT_DIR / ".env.local")
    token = env.get("TELEGRAM_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = env.get("TELEGRAM_CHAT_ID") or os.environ.get("TELEGRAM_CHAT_ID", "")

    if not token or not chat_id:
        sys.exit(0)

    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        data = {}

    event = data.get("hook_event_name", "Stop")

    if event == "Notification":
        text = build_notification_message(data)
    else:
        info: dict = {}
        transcript_path = data.get("transcript_path")
        if transcript_path:
            info = extract_transcript_info(transcript_path)
        text = build_stop_message(data, info)

    try:
        send_telegram(token, chat_id, text)
    except Exception as e:
        print(f"Telegram notify error: {e}", file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()