#!/usr/bin/env bash
# 取得 go-admin（後端）與 go-admin-ui（前端）的固定版本，並套上 INFA 的客製：
#
#   後端：infa/backend/*.go       → go-admin/cmd/migrate/migration/version-local/
#   前端：infa/frontend.patch     → go-admin-ui/
#
# 用法：scripts/setup.sh [backend|frontend|all] [目標目錄，預設為 repo 根目錄]
# 可重複執行：已經是指定版本、已經套過 patch 的就跳過。
set -euo pipefail

GO_ADMIN_REF=e42105e7cd61755f0d21d329e0e69dca7f088a17
GO_ADMIN_UI_REF=91b5a81c4de2595d03e08c96775a9ecb26ed3b84

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WHAT=${1:-all}
DEST=${2:-$ROOT}

fetch() { # url dir ref
  local url=$1 dir=$2 ref=$3
  if [ ! -d "$dir/.git" ]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "$url"
  fi
  if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)" != "$ref" ]; then
    git -C "$dir" fetch -q --depth 1 origin "$ref"
    git -C "$dir" checkout -q "$ref"
  fi
  echo "✓ $(basename "$dir") @ ${ref:0:7}"
}

backend() {
  local dir=$DEST/go-admin
  fetch https://github.com/go-admin-team/go-admin.git "$dir" "$GO_ADMIN_REF"
  cp "$ROOT"/infa/backend/*.go "$dir/cmd/migrate/migration/version-local/"
  echo "✓ 後端選單 migration 已放入 version-local/"
}

frontend() {
  local dir=$DEST/go-admin-ui
  fetch https://github.com/go-admin-team/go-admin-ui.git "$dir" "$GO_ADMIN_UI_REF"
  if git -C "$dir" apply --reverse --check "$ROOT/infa/frontend.patch" 2>/dev/null; then
    echo "✓ 前端 patch 先前已套用"
  else
    git -C "$dir" apply "$ROOT/infa/frontend.patch"
    echo "✓ 前端 patch 已套用"
  fi
}

case $WHAT in
  backend) backend ;;
  frontend) frontend ;;
  all) backend; frontend ;;
  *) echo "用法：$0 [backend|frontend|all] [目標目錄]" >&2; exit 1 ;;
esac
