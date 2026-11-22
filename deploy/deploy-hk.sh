#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
host=rock@cn-hk-fxy-01.rockchin.top
k() { ssh -T -o BatchMode=yes "$host" kubectl -n idoknow "$@"; }
tag=$(git rev-parse HEAD)
k get secret glol-env -o name >/dev/null
anonymous=$(mktemp -d)
trap 'rm -rf "$anonymous"' EXIT
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
  for file in 002-telemetry 003-admin 003-player-saves 004-social 005-social-pending 006-social-register; do
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

# RollingUpdate(maxUnavailable=0) + /api/ready 就绪探针：新 pod 的 DB 通了才摘老 pod
kubectl kustomize deploy/k8s | sed "s/:RELEASE$/:$tag/g" | k apply -f -
for name in postgres minio web; do k rollout status "deployment/glol-$name" --timeout=300s; done
[[ $migrated == 1 ]] || migrate

k exec -i deploy/glol-web -c glol-api -- node --input-type=module <<'JS'
import {S3Client,HeadBucketCommand,CreateBucketCommand} from '@aws-sdk/client-s3'
const client=new S3Client({region:'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true}),params={Bucket:'glol-feedback'}
try{await client.send(new HeadBucketCommand(params))}catch(error){if(error.$metadata?.httpStatusCode!==404)throw error;await client.send(new CreateBucketCommand(params))}
JS
k wait --for=condition=Ready certificate/glol-tls --timeout=300s
