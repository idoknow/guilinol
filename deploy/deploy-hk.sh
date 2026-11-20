#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
host=rock@cn-hk-fxy-01.rockchin.top
k() { ssh -T -o BatchMode=yes "$host" kubectl -n idoknow "$@"; }
tag=$(git rev-parse HEAD)
for secret in glol-env glol-registry glol-feedback-bridge; do k get secret "$secret" -o name >/dev/null; done
test -s public/world/manifest.json
npm ci && npm run build
for image in api web; do
  ref="ghcr.io/idoknow/glol-$image:$tag"
  docker build -f "deploy/$image.Dockerfile" -t "$ref" .
  docker push "$ref"
done
bash deploy/feedback-bridge/build.sh
docker push "ghcr.io/idoknow/glol-feedback-bridge:$tag"
kubectl kustomize deploy/k8s | sed "s/:RELEASE$/:$tag/g" | k apply -f -
for name in postgres minio web; do k rollout status "deployment/glol-$name" --timeout=300s; done
schema=$(printf "select count(*) from information_schema.tables where table_schema='public' and table_name='users';" | k exec -i deploy/glol-postgres -- psql -XAt -U postgres -d glol)
if [[ $schema == 0 ]]; then
  k exec -i deploy/glol-postgres -- psql -X -v ON_ERROR_STOP=1 -U postgres -d glol <deploy/postgres/001-schema.sql
fi
k exec -i deploy/glol-web -c glol-api -- node --input-type=module <<'JS'
import {S3Client,HeadBucketCommand,CreateBucketCommand} from '@aws-sdk/client-s3'
const client=new S3Client({region:'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true}),params={Bucket:'glol-feedback'}
try{await client.send(new HeadBucketCommand(params))}catch(error){if(error.$metadata?.httpStatusCode!==404)throw error;await client.send(new CreateBucketCommand(params))}
JS
k wait --for=condition=Ready certificate/glol-tls --timeout=300s
