param(
  [string]$Region = "us-east-1",
  [string]$StackName = "sky-rush-ecs",
  [string]$EcrRepository = "sky-rush",
  [switch]$DeleteEcr
)

$ErrorActionPreference = "Stop"

Write-Host "Deleting CloudFormation stack: $StackName"
aws cloudformation delete-stack --stack-name $StackName --region $Region
aws cloudformation wait stack-delete-complete --stack-name $StackName --region $Region
Write-Host "Stack deleted."

if ($DeleteEcr) {
  Write-Host "Deleting ECR repository: $EcrRepository"
  aws ecr delete-repository --repository-name $EcrRepository --force --region $Region
  Write-Host "ECR repository deleted."
}
