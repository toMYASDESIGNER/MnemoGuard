#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the CockroachDB Cloud connection string.}"

REGION="${AWS_DEPLOY_REGION:-eu-north-1}"
FUNCTION_NAME="${PUBLIC_FUNCTION_NAME:-MnemoGuardPublicDemo}"
ROLE_NAME="${ROLE_NAME:-MnemoGuardLambdaRole}"
MODEL_ID="${BEDROCK_MODEL_ID:-amazon.nova-lite-v1:0}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
PACKAGE_FILE="$(mktemp --suffix=.zip)"
ENV_FILE="$(mktemp)"

cleanup() {
  rm -f "$PACKAGE_FILE"
  if command -v shred >/dev/null 2>&1; then
    shred -u "$ENV_FILE"
  else
    rm -f "$ENV_FILE"
  fi
}
trap cleanup EXIT

npm install --omit=dev
zip -rq "$PACKAGE_FILE" src web node_modules package.json

chmod 600 "$ENV_FILE"
jq -n \
  --arg databaseUrl "$DATABASE_URL" \
  --arg modelId "$MODEL_ID" \
  '{Variables:{DATABASE_URL:$databaseUrl,BEDROCK_MODEL_ID:$modelId}}' \
  > "$ENV_FILE"

if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$PACKAGE_FILE" \
    --region "$REGION" \
    >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --handler src/aws/public-demo.handler \
    --runtime nodejs22.x \
    --role "$ROLE_ARN" \
    --timeout 15 \
    --memory-size 512 \
    --environment "file://$ENV_FILE" \
    --region "$REGION" \
    >/dev/null
else
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs22.x \
    --role "$ROLE_ARN" \
    --handler src/aws/public-demo.handler \
    --zip-file "fileb://$PACKAGE_FILE" \
    --timeout 15 \
    --memory-size 512 \
    --environment "file://$ENV_FILE" \
    --architectures x86_64 \
    --region "$REGION" \
    >/dev/null
fi

aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
aws lambda put-function-concurrency \
  --function-name "$FUNCTION_NAME" \
  --reserved-concurrent-executions 3 \
  --region "$REGION" \
  >/dev/null

if ! aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda create-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --auth-type NONE \
    --region "$REGION" \
    >/dev/null
fi

aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal '*' \
  --function-url-auth-type NONE \
  --region "$REGION" \
  >/dev/null 2>&1 || true

aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id FunctionURLInvokeAllowPublicAccess \
  --action lambda:InvokeFunction \
  --principal '*' \
  --invoked-via-function-url \
  --region "$REGION" \
  >/dev/null 2>&1 || true

aws lambda get-function-url-config \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query '{FunctionUrl:FunctionUrl,AuthType:AuthType,CreationTime:CreationTime}'

