#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
host=rock@cn-hk-fxy-01.rockchin.top
k() { ssh -T -o BatchMode=yes "$host" kubectl -n idoknow "$@"; }
tag=$(git rev-parse HEAD)
# 同一台机器上不允许两个发版重叠（mkdir 是原子的，macOS 也有；不用 flock）。
# 注意：这只能锁住"同一台机器"，跨机器并发由下面的集群侧检查兜底。
lock=${TMPDIR:-/tmp}/glol-deploy-hk.lock.d
if ! mkdir "$lock" 2>/dev/null; then
  if [[ -n "$(find "$lock" -maxdepth 0 -mmin +30 2>/dev/null)" ]]; then
    echo "清理 30 分钟前的残留锁 $lock" >&2
    rm -rf "$lock"
    mkdir "$lock" 2>/dev/null || { echo "另一个发版正在进行（锁 $lock）" >&2; exit 1; }
  else
    echo "另一个发版正在进行（锁 $lock）；确认无人发版可手动 rm -rf $lock" >&2; exit 1
  fi
fi
k get secret glol-env -o name >/dev/null
anonymous=$(mktemp -d)
trap 'rm -rf "$anonymous" "$lock"' EXIT
for image in api web; do
  ref="ghcr.io/idoknow/glol-$image:$tag"
  for attempt in {1..30}; do
    docker --config "$anonymous" pull "$ref" >/dev/null && break
    if [[ $attempt == 30 ]]; then echo "Not publicly available: $ref" >&2; exit 1; fi
    sleep 10
  done
done

# 表结构迁移。全部是幂等 DDL，只做加法（建表/加列/放宽约束），老代码跑在新结构上仍然正常。
migrate() {
  local schema
  schema=$(printf "select count(*) from information_schema.tables where table_schema='public' and table_name='users';" | k exec -i deploy/glol-postgres -- psql -XAt -U postgres -d glol)
  if [[ $schema == 0 ]]; then
    k exec -i deploy/glol-postgres -- psql -X -v ON_ERROR_STOP=1 -U postgres -d glol <deploy/postgres/001-schema.sql
  fi
  for file in 002-telemetry 003-admin 003-player-saves 004-social 005-social-pending 006-social-register 007-social-only; do
    k exec -i deploy/glol-postgres -- psql -X -v ON_ERROR_STOP=1 -U postgres -d glol <"deploy/postgres/$file.sql"
  done
}

# 顺序很关键：已有库时**先迁移、再换镜像**。
# 老 pod 继续对外服务（跑的是上一版代码 + 新结构，后向兼容），
# 新 pod 起来就能直接用新表，不会出现"新代码先上线、表还没建"的空窗。
migrated=0
if k get deployment glol-postgres >/dev/null 2>&1; then
  k rollout status deployment/glol-postgres --timeout=300s
  migrate
  migrated=1
fi

# k() 走 ssh，参数会被远端 shell 重新解析：jsonpath 必须再包一层单引号，否则 [?(...)] 被 zsh 当 glob。
# 集群侧兜底：另一台机器发起的发版可能正在滚动，这时覆盖镜像会让两边都报成功
current=$(k get deployment glol-web -o "jsonpath='{.spec.template.spec.containers[?(@.name==\"glol-api\")].image}'" 2>/dev/null || true)
if [[ -n "$current" && "$current" != *":$tag" ]]; then
  reason=$(k get deployment glol-web -o "jsonpath='{.status.conditions[?(@.type==\"Progressing\")].reason}'" 2>/dev/null || true)
  if [[ "$reason" == "ReplicaSetUpdated" ]]; then
    echo "集群正在滚动到 ${current##*:}，另一个发版在进行，退出" >&2
    exit 1
  fi
fi

# RollingUpdate(maxUnavailable=0) + /api/ready 就绪探针：新 pod 就绪后才摘老 pod
kubectl kustomize deploy/k8s | sed "s/:RELEASE$/:$tag/g" | k apply -f -
for name in postgres minio; do k rollout status "deployment/glol-$name" --timeout=300s; done
# 首次装库：/api/ready 要求 public.users 存在，所以迁移必须早于 web 就绪
[[ $migrated == 1 ]] || migrate
k rollout status deployment/glol-web --timeout=300s
# 确认最终跑的就是本次要发的镜像（防止并发发版把镜像改回去）
applied=$(k get deployment/glol-web -o "jsonpath='{.spec.template.spec.containers[?(@.name==\"glol-api\")].image}'")
[[ $applied == *":$tag" ]] || { echo "镜像与本次发版不一致：$applied ≠ :$tag" >&2; exit 1; }

k exec -i deploy/glol-web -c glol-api -- node --input-type=module <<'JS'
import {S3Client,HeadBucketCommand,CreateBucketCommand} from '@aws-sdk/client-s3'
const client=new S3Client({region:'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true}),params={Bucket:'glol-feedback'}
try{await client.send(new HeadBucketCommand(params))}catch(error){if(error.$metadata?.httpStatusCode!==404)throw error;await client.send(new CreateBucketCommand(params))}
JS
k wait --for=condition=Ready certificate/glol-tls --timeout=300s
