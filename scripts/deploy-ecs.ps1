param(
  [string]$Region = "us-east-1",
  [string]$AppName = "sky-rush",
  [string]$EcrRepository = "sky-rush",
  [string]$StackName = "sky-rush-ecs",
  [int]$DesiredCount = 1
)

$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$ContainerPort = 3000

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not installed or not available in PATH."
  }
}

Require-Command "aws"
Require-Command "docker"
Require-Command "git"

function Invoke-Native($Command, $Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

$Identity = aws sts get-caller-identity --region $Region | ConvertFrom-Json
$AccountId = $Identity.Account
$Registry = "$AccountId.dkr.ecr.$Region.amazonaws.com"
$ImageTag = (git rev-parse --short HEAD).Trim()
if (-not $ImageTag) {
  $ImageTag = (Get-Date -Format "yyyyMMddHHmmss")
}
$ImageUri = "$Registry/$EcrRepository`:$ImageTag"

Write-Host "AWS account: $AccountId"
Write-Host "Region: $Region"
Write-Host "ECR repository: $EcrRepository"
Write-Host "Image: $ImageUri"

$PreviousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
aws ecr describe-repositories --repository-names $EcrRepository --region $Region *> $null
$DescribeRepositoryExitCode = $LASTEXITCODE
$ErrorActionPreference = $PreviousErrorActionPreference

if ($DescribeRepositoryExitCode -eq 0) {
  Write-Host "ECR repository already exists."
} else {
  Write-Host "Creating ECR repository..."
  Invoke-Native "aws" @(
    "ecr", "create-repository",
    "--repository-name", $EcrRepository,
    "--image-scanning-configuration", "scanOnPush=true",
    "--region", $Region
  )
}

Write-Host "Logging in to ECR..."
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $Registry
if ($LASTEXITCODE -ne 0) {
  throw "Docker login failed. Make sure Docker Desktop is running."
}

Write-Host "Building Docker image..."
Invoke-Native "docker" @("build", "-t", $ImageUri, ".")

Write-Host "Pushing Docker image..."
Invoke-Native "docker" @("push", $ImageUri)

Write-Host "Deploying CloudFormation stack..."
Invoke-Native "aws" @(
  "cloudformation", "deploy",
  "--template-file", "infra/cloudformation.yml",
  "--stack-name", $StackName,
  "--parameter-overrides",
  "AppName=$AppName",
  "ImageUri=$ImageUri",
  "ContainerPort=$ContainerPort",
  "DesiredCount=$DesiredCount",
  "--capabilities", "CAPABILITY_NAMED_IAM",
  "--region", $Region
)

Write-Host "Deployment outputs:"
aws cloudformation describe-stacks `
  --stack-name $StackName `
  --region $Region `
  --query "Stacks[0].Outputs" `
  --output table
