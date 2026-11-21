#!/usr/bin/env bash
# 平时不用运行它：推送到 GitHub 的 main 分支后，服务器一分钟内会自己更新。
# 不想等这一分钟时，在项目根目录运行  bash deploy/deploy.sh  让服务器立刻拉取。
set -euo pipefail
ssh reader-server "sudo systemctl start app-scanner-pull && systemctl is-active app-scanner && git -C /opt/apps/scanner log -1 --format='线上版本：%h %s'"
