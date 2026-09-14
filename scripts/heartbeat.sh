#!/usr/bin/env bash
# The heartbeat, headless: the bakara agent runs /bakara-heartbeat with no user present (nothing is decided;
# the summary is what the user reads next), for cron or launchd. Needs `claude` on the PATH and its login,
# (an ANTHROPIC_API_KEY in the environment would bill the API instead). The bakara tools are pre-approved
# (--allowedTools) and nothing waits on a prompt (--permission-prompts none); reset, SQL and the shell are denied.
#
#   ./scripts/heartbeat.sh            # one pass on the default project
#   ./scripts/heartbeat.sh HADARIM    # a project id
#   crontab: 0 * * * * cd /path/to/nadlan.ai && ./scripts/heartbeat.sh >> out/heartbeat.log 2>&1
#
# The deterministic work list without the agent (no model, no key): npm run bakara -- heartbeat
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${1:-HADARIM}"
mkdir -p out
echo "== $(date -Iseconds) heartbeat $PROJECT"
claude -p --agent bakara --permission-mode manual --permission-prompts none --allowedTools "mcp__bakara__*,Read,Skill" --disallowedTools "mcp__bakara__reset_project,mcp__supabase__execute_sql,Bash,Edit,Write" "פעימת לב לפרויקט $PROJECT: הרץ /bakara-heartbeat. אין משתמש בצד השני — עבד מסמכים, בדוק שינויים, אל תחליט ואל תתקן דבר, רשום את הפעימה וסכם בעברית." || echo "heartbeat failed"
