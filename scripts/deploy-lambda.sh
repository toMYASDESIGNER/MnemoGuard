#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the CockroachDB Cloud connection string.}"

REGION="${AWS_DEPLOY_REGION:-eu-north-1}"
FUNCTION_NAME="${FUNCTION_NAME:-MnemoGuardMemoryFirewall}"
ROLE_NAME="${ROLE_NAME:-MnemoGuardLambdaRole}"
MODEL_ID="${BEDROCK_MODEL_ID:-amazon.nova-lite-v1:0}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
TEMP_DIR="$(mktemp -d)"
PACKAGE_FILE="$TEMP_DIR/function.zip"
ENV_FILE="$TEMP_DIR/environment.json"

cleanup() {
  rm -f "$PACKAGE_FILE"
  if [[ -f "$ENV_FILE" ]] && command -v shred >/dev/null 2>&1; then
    shred -u "$ENV_FILE"
  else
    rm -f "$ENV_FILE"
  fi
  rmdir "$TEMP_DIR"
}
trap cleanup EXIT

npm install --omit=dev
zip -rq "$PACKAGE_FILE" src node_modules package.json

if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    >/dev/null
fi

aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name MnemoGuardBedrockInvoke \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["bedrock:InvokeModel"],"Resource":"*"}]}'

: > "$ENV_FILE"
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
    --handler src/aws/lambda.handler \
    --runtime nodejs22.x \
    --role "$ROLE_ARN" \
    --timeout 30 \
    --memory-size 512 \
    --environment "file://$ENV_FILE" \
    --region "$REGION" \
    >/dev/null
else
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs22.x \
    --role "$ROLE_ARN" \
    --handler src/aws/lambda.handler \
    --zip-file "fileb://$PACKAGE_FILE" \
    --timeout 30 \
    --memory-size 512 \
    --environment "file://$ENV_FILE" \
    --architectures x86_64 \
    --region "$REGION" \
    >/dev/null
fi

aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
aws lambda get-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query '{FunctionArn:FunctionArn,State:State,Runtime:Runtime,LastModified:LastModified}'
