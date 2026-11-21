#!/usr/bin/env bash
# 在服务器上运行（由 app-scanner-pull.timer 每分钟触发一次）：
# GitHub 的 main 分支有新提交时，拉取并重启服务。data/ 不在仓库里，不会被动到。
set -euo pipefail
cd /opt/apps/scanner
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
git reset -q --hard origin/main
sudo systemctl restart app-scanner
echo "已更新到 $(git log -1 --format='%h %s')"
