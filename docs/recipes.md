# Recipes

Minimal credential servers you can run locally alongside the extension. Each listens on a port, receives forwarded IMDS requests from the extension, reads container labels from the `x-container-labels` header, and responds in the format the cloud SDK expects.

Point the extension at `http://localhost:<port>` in the Settings tab.

Each recipe runs its cloud CLI once per request. One credential fetch takes several requests, so it mints several sessions. Cache the CLI result until shortly before it expires if you use a recipe for more than a quick test.

---

## AWS

Handles the IMDSv2 token endpoint, credentials and region in one server. Reads `AWS_PROFILE` and `AWS_DEFAULT_REGION` labels from the requesting container. If a label is not set, both values fall back to host environment values. The server reports one role name, `barnacle`, and serves credentials under that name. Requires the AWS CLI, `socat` and `jq`.

1. Label your container:

   ```yaml
   labels:
     - "imds-proxy.enabled=true"
     - "AWS_PROFILE=my-profile"
     - "AWS_DEFAULT_REGION=us-west-2"
   ```

2. Run the server for your shell.

   zsh/bash:

   ```bash
   #!/usr/bin/env bash
   PORT=${1:-8080}
   ROLE=barnacle
   # socat keeps listening and forks one handler per connection. A one-shot nc loop
   # is unreachable while it rebinds, which breaks SDKs that make several calls in a row.
   if [ "$1" != "--handle" ]; then
     exec socat TCP-LISTEN:$PORT,reuseaddr,fork SYSTEM:"bash $(realpath "$0") --handle"
   fi

   # Everything below runs once per request, with the socket on stdin and stdout.
   # Read the HTTP request line (e.g. "GET /latest/meta-data/... HTTP/1.1")
   read -r line
   METHOD=$(echo "$line" | awk '{print $1}')
   PATH_REQ=$(echo "$line" | awk '{print $2}')

   # Read headers until the blank line that ends the HTTP header block
   while IFS= read -r h && [ "$h" != $'\r' ]; do
     # ${h,,} lowercases the header name for case-insensitive matching
     [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
   done

   STATUS="200 OK"
   CTYPE="text/plain"
   BODY=""

   if [[ "$METHOD" == "PUT" && "$PATH_REQ" == */latest/api/token ]]; then
     # IMDSv2 token. The client sends it back in X-aws-ec2-metadata-token, which this server does not check.
     BODY="barnacle-imdsv2-token"
   elif [[ "$PATH_REQ" == */placement/region ]]; then
     REGION=$(echo "$LABELS" | jq -r '.AWS_DEFAULT_REGION // empty')
     BODY=${REGION:-${AWS_DEFAULT_REGION:-us-east-1}}
   elif [[ "$PATH_REQ" == */iam/security-credentials/ ]]; then
     # The client reads the role name here, then asks for that role's credentials
     BODY="$ROLE"
   elif [[ "$PATH_REQ" == */iam/security-credentials/"$ROLE" ]]; then
     PROFILE=$(echo "$LABELS" | jq -r '.AWS_PROFILE // "default"')
     CREDS=$(AWS_PROFILE=$PROFILE aws sts get-session-token --query Credentials --output json)
     BODY=$(echo "$CREDS" | jq -c '{Code:"Success",Type:"AWS-HMAC",
       AccessKeyId:.AccessKeyId,SecretAccessKey:.SecretAccessKey,
       Token:.SessionToken,Expiration:.Expiration}')
     CTYPE="application/json"
   else
     STATUS="404 Not Found"
   fi
   printf "HTTP/1.1 $STATUS\r\nContent-Type: $CTYPE\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n$BODY"
   ```

   If you use PowerShell, run this version instead:

   ```powershell
   $port = 8080
   $role = "barnacle"
   $listener = [System.Net.HttpListener]::new()
   $listener.Prefixes.Add("http://localhost:$port/")
   # host.docker.internal resolves to the host from inside a Docker container
   $listener.Prefixes.Add("http://host.docker.internal:$port/")
   $listener.Start()
   Write-Host "AWS IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx = $listener.GetContext()
       $labels = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $path = $ctx.Request.Url.AbsolutePath
       $ctx.Response.ContentType = "text/plain"
       if ($ctx.Request.HttpMethod -eq "PUT" -and $path -like "*/latest/api/token") {
           # IMDSv2 token. The client sends it back in X-aws-ec2-metadata-token, which this server does not check.
           $body = "barnacle-imdsv2-token"
       } elseif ($path -like "*/placement/region") {
           $body = if ($labels?["AWS_DEFAULT_REGION"]) { $labels["AWS_DEFAULT_REGION"] }
                   elseif ($env:AWS_DEFAULT_REGION) { $env:AWS_DEFAULT_REGION }
                   else { "us-east-1" }
       } elseif ($path -like "*/iam/security-credentials/") {
           # The client reads the role name here, then asks for that role's credentials
           $body = $role
       } elseif ($path -like "*/iam/security-credentials/$role") {
           $profile = if ($labels?["AWS_PROFILE"]) { $labels["AWS_PROFILE"] } else { "default" }
           $creds = aws sts get-session-token --profile $profile --query Credentials --output json | ConvertFrom-Json
           $body  = @{ Code="Success"; Type="AWS-HMAC"; AccessKeyId=$creds.AccessKeyId
                       SecretAccessKey=$creds.SecretAccessKey; Token=$creds.SessionToken
                       Expiration=$creds.Expiration } | ConvertTo-Json -Compress
           $ctx.Response.ContentType = "application/json"
       } else {
           $ctx.Response.StatusCode = 404
           $ctx.Response.Close()
           continue
       }
       $bytes = [Text.Encoding]::UTF8.GetBytes($body)
       $ctx.Response.ContentLength64 = $bytes.Length
       $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
       $ctx.Response.Close()
   }
   ```

---

## Azure

Returns an access token for the resource requested by the container. Reads the `resource` query parameter from the IMDS request and passes it to the Azure CLI. The `AZURE_CLIENT_ID` label selects a specific managed identity. If you omit it, the server uses the active `az` account. Requires the Azure CLI.

1. Label your container:

   ```yaml
   labels:
     - "imds-proxy.enabled=true"
     - "AZURE_CLIENT_ID=<optional-managed-identity-client-id>"
   ```

2. Run the server for your shell.

   zsh/bash:

   ```bash
   #!/usr/bin/env bash
   PORT=${1:-8080}
   while true; do
     {
       # Read the HTTP request line and extract the resource query parameter from the URL
       read -r line
       QUERY=$(echo "$line" | awk '{print $2}' | grep -o 'resource=[^&]*' | cut -d= -f2-)
       RESOURCE=${QUERY:-https://management.azure.com/}

       # Read headers until the blank line that ends the HTTP header block
       while IFS= read -r h && [ "$h" != $'\r' ]; do
         # ${h,,} lowercases the header name for case-insensitive matching
         [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
       done

       CLIENT_ID=$(echo "$LABELS" | jq -r '.AZURE_CLIENT_ID // empty')
       # ${CLIENT_ID:+--client-id "$CLIENT_ID"} expands to nothing if CLIENT_ID is unset
       TOKEN=$(az account get-access-token --resource "$RESOURCE" ${CLIENT_ID:+--client-id "$CLIENT_ID"} --output json)
       BODY=$(echo "$TOKEN" | jq -c '{access_token:.accessToken,expires_in:3599,token_type:"Bearer"}')
       printf "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n$BODY"
     # nc handles one HTTP request per invocation; the outer loop restarts it for the next request
     } | nc -l -p $PORT -q 1
   done
   ```

   If you use PowerShell, run this version instead:

   ```powershell
   $port = 8080
   $listener = [System.Net.HttpListener]::new()
   $listener.Prefixes.Add("http://localhost:$port/")
   # host.docker.internal resolves to the host from inside a Docker container
   $listener.Prefixes.Add("http://host.docker.internal:$port/")
   $listener.Start()
   Write-Host "Azure IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx = $listener.GetContext()
       $labels   = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $resource = if ($ctx.Request.QueryString["resource"]) { $ctx.Request.QueryString["resource"] }
                   else { "https://management.azure.com/" }
       $clientId = $labels?["AZURE_CLIENT_ID"]
       $args     = @("account", "get-access-token", "--resource", $resource, "--output", "json")
       if ($clientId) { $args += "--client-id"; $args += $clientId }
       $token = & az @args | ConvertFrom-Json
       $body  = @{ access_token=$token.accessToken; expires_in=3599; token_type="Bearer" } | ConvertTo-Json -Compress
       $bytes = [Text.Encoding]::UTF8.GetBytes($body)
       $ctx.Response.ContentType = "application/json"
       $ctx.Response.ContentLength64 = $bytes.Length
       $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
       $ctx.Response.Close()
   }
   ```

---

## GCP

Returns an access token for the service account named in the container's `GCP_SERVICE_ACCOUNT` label. If the label is not set, falls back to the active `gcloud` account. Requires the `gcloud` CLI.

1. Label your container:

   ```yaml
   labels:
     - "imds-proxy.enabled=true"
     - "GCP_SERVICE_ACCOUNT=my-sa@my-project.iam.gserviceaccount.com"
   ```

2. Run the server for your shell.

   zsh/bash:

   ```bash
   #!/usr/bin/env bash
   PORT=${1:-8080}
   while true; do
     {
       # Discard the request line; GCP token endpoint has no path-dependent behavior
       read -r _req

       # Read headers until the blank line that ends the HTTP header block
       while IFS= read -r h && [ "$h" != $'\r' ]; do
         # ${h,,} lowercases the header name for case-insensitive matching
         [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
       done

       SA=$(echo "$LABELS" | jq -r '.GCP_SERVICE_ACCOUNT // empty')
       # ${SA:+--impersonate-service-account=$SA} expands to nothing if SA is unset
       TOKEN=$(gcloud auth print-access-token ${SA:+--impersonate-service-account=$SA})
       # date -d is GNU (Linux); date -v is BSD (macOS). Try both.
       EXPIRY=$(date -u -d "+3599 seconds" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v+3599S +"%Y-%m-%dT%H:%M:%SZ")
       BODY="{\"access_token\":\"$TOKEN\",\"expires_in\":3599,\"token_type\":\"Bearer\"}"
       printf "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n$BODY"
     # nc handles one HTTP request per invocation; the outer loop restarts it for the next request
     } | nc -l -p $PORT -q 1
   done
   ```

   If you use PowerShell, run this version instead:

   ```powershell
   $port = 8080
   $listener = [System.Net.HttpListener]::new()
   $listener.Prefixes.Add("http://localhost:$port/")
   # host.docker.internal resolves to the host from inside a Docker container
   $listener.Prefixes.Add("http://host.docker.internal:$port/")
   $listener.Start()
   Write-Host "GCP IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx = $listener.GetContext()
       $labels = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $sa    = $labels?["GCP_SERVICE_ACCOUNT"]
       $token = if ($sa) { gcloud auth print-access-token --impersonate-service-account=$sa }
                else { gcloud auth print-access-token }
       $body  = @{ access_token=$token.Trim(); expires_in=3599; token_type="Bearer" } | ConvertTo-Json -Compress
       $bytes = [Text.Encoding]::UTF8.GetBytes($body)
       $ctx.Response.ContentType = "application/json"
       $ctx.Response.ContentLength64 = $bytes.Length
       $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
       $ctx.Response.Close()
   }
   ```

---

## Alibaba Cloud

Returns RAM role credentials. Reports the role name from the `ALIBABA_ROLE` label and assumes the role named by the `ALIBABA_ROLE_ARN` label. Requires the `aliyun` CLI, `socat` and `jq`.

1. Add `100.100.100.200` in the Settings tab to intercept Alibaba Cloud IMDS traffic.

2. Label your container:

   ```yaml
   labels:
     - "imds-proxy.enabled=true"
     - "ALIBABA_ROLE=my-ram-role"
     - "ALIBABA_ROLE_ARN=acs:ram::123456789:role/my-ram-role"
   ```

3. Run the server for your shell.

   zsh/bash:

   ```bash
   #!/usr/bin/env bash
   PORT=${1:-8080}
   # socat keeps listening and forks one handler per connection. A one-shot nc loop
   # is unreachable while it rebinds, which breaks SDKs that make several calls in a row.
   if [ "$1" != "--handle" ]; then
     exec socat TCP-LISTEN:$PORT,reuseaddr,fork SYSTEM:"bash $(realpath "$0") --handle"
   fi

   # Everything below runs once per request, with the socket on stdin and stdout.
   # Read the HTTP request line (e.g. "GET /latest/meta-data/... HTTP/1.1")
   read -r line
   METHOD=$(echo "$line" | awk '{print $1}')
   PATH_REQ=$(echo "$line" | awk '{print $2}')

   # Read headers until the blank line that ends the HTTP header block
   while IFS= read -r h && [ "$h" != $'\r' ]; do
     # ${h,,} lowercases the header name for case-insensitive matching
     [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
   done

   ROLE=$(echo "$LABELS" | jq -r '.ALIBABA_ROLE // empty')
   ROLE=${ROLE:-barnacle}
   STATUS="200 OK"
   CTYPE="text/plain"
   BODY=""

   if [[ "$METHOD" == "PUT" && "$PATH_REQ" == */latest/api/token ]]; then
     # Metadata token. The client sends it back in X-aliyun-ecs-metadata-token, which this server does not check.
     BODY="barnacle-metadata-token"
   elif [[ "$PATH_REQ" == */ram/security-credentials/ ]]; then
     # The client reads the role name here, then asks for that role's credentials
     BODY="$ROLE"
   elif [[ "$PATH_REQ" == */ram/security-credentials/"$ROLE" ]]; then
     ROLE_ARN=$(echo "$LABELS" | jq -r '.ALIBABA_ROLE_ARN // empty')
     CREDS=$(aliyun sts AssumeRole --RoleArn "$ROLE_ARN" --RoleSessionName barnacle-session --output json)
     BODY=$(echo "$CREDS" | jq -c '.Credentials | {Code:"Success",AccessKeyId:.AccessKeyId,
       AccessKeySecret:.AccessKeySecret,SecurityToken:.SecurityToken,Expiration:.Expiration}')
     CTYPE="application/json"
   else
     STATUS="404 Not Found"
   fi
   printf "HTTP/1.1 $STATUS\r\nContent-Type: $CTYPE\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n$BODY"
   ```

   If you use PowerShell, run this version instead:

   ```powershell
   $port = 8080
   $listener = [System.Net.HttpListener]::new()
   $listener.Prefixes.Add("http://localhost:$port/")
   # host.docker.internal resolves to the host from inside a Docker container
   $listener.Prefixes.Add("http://host.docker.internal:$port/")
   $listener.Start()
   Write-Host "Alibaba Cloud IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx    = $listener.GetContext()
       $labels = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $role   = if ($labels?["ALIBABA_ROLE"]) { $labels["ALIBABA_ROLE"] } else { "barnacle" }
       $path   = $ctx.Request.Url.AbsolutePath
       $ctx.Response.ContentType = "text/plain"
       if ($ctx.Request.HttpMethod -eq "PUT" -and $path -like "*/latest/api/token") {
           # Metadata token. The client sends it back in X-aliyun-ecs-metadata-token, which this server does not check.
           $body = "barnacle-metadata-token"
       } elseif ($path -like "*/ram/security-credentials/") {
           # The client reads the role name here, then asks for that role's credentials
           $body = $role
       } elseif ($path -like "*/ram/security-credentials/$role") {
           $roleArn = $labels?["ALIBABA_ROLE_ARN"]
           $creds   = aliyun sts AssumeRole --RoleArn $roleArn --RoleSessionName barnacle-session --output json | ConvertFrom-Json
           $body    = @{ Code="Success"; AccessKeyId=$creds.Credentials.AccessKeyId
                         AccessKeySecret=$creds.Credentials.AccessKeySecret
                         SecurityToken=$creds.Credentials.SecurityToken
                         Expiration=$creds.Credentials.Expiration } | ConvertTo-Json -Compress
           $ctx.Response.ContentType = "application/json"
       } else {
           $ctx.Response.StatusCode = 404
           $ctx.Response.Close()
           continue
       }
       $bytes = [Text.Encoding]::UTF8.GetBytes($body)
       $ctx.Response.ContentLength64 = $bytes.Length
       $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
       $ctx.Response.Close()
   }
   ```

---

## Tencent Cloud

Returns CAM role credentials. Reads the `TENCENT_ROLE` label to select which CAM role to use. Requires the `tccli` CLI, `socat` and `jq`.

1. Add `169.254.0.23` in the Settings tab to intercept Tencent Cloud IMDS traffic.

2. Label your container:

   ```yaml
   labels:
     - "imds-proxy.enabled=true"
     - "TENCENT_ROLE=my-cam-role"
   ```

3. Run the server for your shell.

   zsh/bash:

   ```bash
   #!/usr/bin/env bash
   PORT=${1:-8080}
   # socat keeps listening and forks one handler per connection. A one-shot nc loop
   # is unreachable while it rebinds, which breaks SDKs that make several calls in a row.
   if [ "$1" != "--handle" ]; then
     exec socat TCP-LISTEN:$PORT,reuseaddr,fork SYSTEM:"bash $(realpath "$0") --handle"
   fi

   # Everything below runs once per request, with the socket on stdin and stdout.
   # Read the HTTP request line (e.g. "GET /latest/meta-data/... HTTP/1.1")
   read -r line
   PATH_REQ=$(echo "$line" | awk '{print $2}')

   # Read headers until the blank line that ends the HTTP header block
   while IFS= read -r h && [ "$h" != $'\r' ]; do
     # ${h,,} lowercases the header name for case-insensitive matching
     [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
   done

   ROLE=$(echo "$LABELS" | jq -r '.TENCENT_ROLE // empty')
   ROLE=${ROLE:-barnacle}
   STATUS="200 OK"
   CTYPE="text/plain"
   BODY=""

   if [[ "$PATH_REQ" == */cam/security-credentials/ ]]; then
     # The client reads the role name here, then asks for that role's credentials
     BODY="$ROLE"
   elif [[ "$PATH_REQ" == */cam/security-credentials/"$ROLE" ]]; then
     # Look up the caller's UIN (account ID) to construct the full role ARN
     CREDS=$(tccli sts AssumeRole --RoleArn "qcs::cam::uin/$(tccli sts GetCallerIdentity --output json | jq -r '.UserId'):roleName/$ROLE" --RoleSessionName barnacle-session --output json)
     BODY=$(echo "$CREDS" | jq -c '.Credentials | {Code:"Success",TmpSecretId:.TmpSecretId,
       TmpSecretKey:.TmpSecretKey,Token:.Token,ExpiredTime:(.ExpiredTime|tostring)}')
     CTYPE="application/json"
   else
     STATUS="404 Not Found"
   fi
   printf "HTTP/1.1 $STATUS\r\nContent-Type: $CTYPE\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n$BODY"
   ```

   If you use PowerShell, run this version instead:

   ```powershell
   $port = 8080
   $listener = [System.Net.HttpListener]::new()
   $listener.Prefixes.Add("http://localhost:$port/")
   # host.docker.internal resolves to the host from inside a Docker container
   $listener.Prefixes.Add("http://host.docker.internal:$port/")
   $listener.Start()
   Write-Host "Tencent Cloud IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx    = $listener.GetContext()
       $labels = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $role   = if ($labels?["TENCENT_ROLE"]) { $labels["TENCENT_ROLE"] } else { "barnacle" }
       $path   = $ctx.Request.Url.AbsolutePath
       $ctx.Response.ContentType = "text/plain"
       if ($path -like "*/cam/security-credentials/") {
           # The client reads the role name here, then asks for that role's credentials
           $body = $role
       } elseif ($path -like "*/cam/security-credentials/$role") {
           # Look up the caller's UIN to construct the full role ARN
           $uid   = tccli sts GetCallerIdentity --output json | ConvertFrom-Json | Select-Object -ExpandProperty UserId
           $arn   = "qcs::cam::uin/${uid}:roleName/$role"
           $creds = tccli sts AssumeRole --RoleArn $arn --RoleSessionName barnacle-session --output json | ConvertFrom-Json
           $body  = @{ Code="Success"; TmpSecretId=$creds.Credentials.TmpSecretId
                       TmpSecretKey=$creds.Credentials.TmpSecretKey
                       Token=$creds.Credentials.Token
                       ExpiredTime=$creds.Credentials.ExpiredTime } | ConvertTo-Json -Compress
           $ctx.Response.ContentType = "application/json"
       } else {
           $ctx.Response.StatusCode = 404
           $ctx.Response.Close()
           continue
       }
       $bytes = [Text.Encoding]::UTF8.GetBytes($body)
       $ctx.Response.ContentLength64 = $bytes.Length
       $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
       $ctx.Response.Close()
   }
   ```

---

## Multi-cloud (AWS + Azure)

One server handles both AWS and Azure. It routes by the `CLOUD_PROVIDER` container label; each container declares which provider it needs. Extend the pattern to add more providers. Requires the AWS CLI, the Azure CLI, `socat` and `jq`.

1. Label your container:

   ```yaml
   labels:
     - "imds-proxy.enabled=true"
     - "CLOUD_PROVIDER=aws"          # or "azure"
     - "AWS_PROFILE=my-profile"      # AWS only
     - "AWS_DEFAULT_REGION=us-west-2" # AWS only, optional
     - "AZURE_CLIENT_ID=<client-id>" # Azure only, optional
   ```

2. Run the server for your shell.

   zsh/bash:

   ```bash
   #!/usr/bin/env bash
   PORT=${1:-8080}
   ROLE=barnacle
   # socat keeps listening and forks one handler per connection. A one-shot nc loop
   # is unreachable while it rebinds, which breaks SDKs that make several calls in a row.
   if [ "$1" != "--handle" ]; then
     exec socat TCP-LISTEN:$PORT,reuseaddr,fork SYSTEM:"bash $(realpath "$0") --handle"
   fi

   # Everything below runs once per request, with the socket on stdin and stdout.
   # Read the HTTP request line and extract method and path for provider routing
   read -r line
   METHOD=$(echo "$line" | awk '{print $1}')
   PATH_REQ=$(echo "$line" | awk '{print $2}')

   # Read headers until the blank line that ends the HTTP header block
   while IFS= read -r h && [ "$h" != $'\r' ]; do
     # ${h,,} lowercases the header name for case-insensitive matching
     [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
   done

   PROVIDER=$(echo "$LABELS" | jq -r '.CLOUD_PROVIDER // "aws"')
   CTYPE="application/json"
   STATUS="200 OK"
   BODY=""

   if [[ "$METHOD" == "PUT" && "$PATH_REQ" == */latest/api/token && "$PROVIDER" == "aws" ]]; then
     # IMDSv2 token. The client sends it back in X-aws-ec2-metadata-token, which this server does not check.
     BODY="barnacle-imdsv2-token"
     CTYPE="text/plain"
   elif [[ "$PATH_REQ" == */placement/region ]]; then
     REGION=$(echo "$LABELS" | jq -r '.AWS_DEFAULT_REGION // empty')
     BODY=${REGION:-${AWS_DEFAULT_REGION:-us-east-1}}
     CTYPE="text/plain"
   elif [[ "$PATH_REQ" == */iam/security-credentials/ && "$PROVIDER" == "aws" ]]; then
     # The client reads the role name here, then asks for that role's credentials
     BODY="$ROLE"
     CTYPE="text/plain"
   elif [[ "$PATH_REQ" == */iam/security-credentials/"$ROLE" && "$PROVIDER" == "aws" ]]; then
     PROFILE=$(echo "$LABELS" | jq -r '.AWS_PROFILE // "default"')
     CREDS=$(AWS_PROFILE=$PROFILE aws sts get-session-token --query Credentials --output json)
     BODY=$(echo "$CREDS" | jq -c '{Code:"Success",Type:"AWS-HMAC",
       AccessKeyId:.AccessKeyId,SecretAccessKey:.SecretAccessKey,
       Token:.SessionToken,Expiration:.Expiration}')
   elif [[ "$PATH_REQ" == *metadata/identity/oauth2/token* && "$PROVIDER" == "azure" ]]; then
     QUERY=$(echo "$PATH_REQ" | grep -o 'resource=[^&]*' | cut -d= -f2-)
     RESOURCE=${QUERY:-https://management.azure.com/}
     CLIENT_ID=$(echo "$LABELS" | jq -r '.AZURE_CLIENT_ID // empty')
     # ${CLIENT_ID:+--client-id "$CLIENT_ID"} expands to nothing if CLIENT_ID is unset
     TOKEN=$(az account get-access-token --resource "$RESOURCE" ${CLIENT_ID:+--client-id "$CLIENT_ID"} --output json)
     BODY=$(echo "$TOKEN" | jq -c '{access_token:.accessToken,expires_in:3599,token_type:"Bearer"}')
   else
     STATUS="404 Not Found"
   fi
   printf "HTTP/1.1 $STATUS\r\nContent-Type: $CTYPE\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n$BODY"
   ```

   If you use PowerShell, run this version instead:

   ```powershell
   $port = 8080
   $role = "barnacle"
   $listener = [System.Net.HttpListener]::new()
   $listener.Prefixes.Add("http://localhost:$port/")
   # host.docker.internal resolves to the host from inside a Docker container
   $listener.Prefixes.Add("http://host.docker.internal:$port/")
   $listener.Start()
   Write-Host "Multi-cloud IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx      = $listener.GetContext()
       $labels   = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $provider = if ($labels?["CLOUD_PROVIDER"]) { $labels["CLOUD_PROVIDER"] } else { "aws" }
       $path     = $ctx.Request.Url.AbsolutePath
       if ($ctx.Request.HttpMethod -eq "PUT" -and $path -like "*/latest/api/token" -and $provider -eq "aws") {
           # IMDSv2 token. The client sends it back in X-aws-ec2-metadata-token, which this server does not check.
           $body = "barnacle-imdsv2-token"
           $ctx.Response.ContentType = "text/plain"
       } elseif ($path -like "*/placement/region") {
           $body = if ($labels?["AWS_DEFAULT_REGION"]) { $labels["AWS_DEFAULT_REGION"] }
                   elseif ($env:AWS_DEFAULT_REGION) { $env:AWS_DEFAULT_REGION }
                   else { "us-east-1" }
           $ctx.Response.ContentType = "text/plain"
       } elseif ($path -like "*/iam/security-credentials/" -and $provider -eq "aws") {
           # The client reads the role name here, then asks for that role's credentials
           $body = $role
           $ctx.Response.ContentType = "text/plain"
       } elseif ($path -like "*/iam/security-credentials/$role" -and $provider -eq "aws") {
           $profile = if ($labels?["AWS_PROFILE"]) { $labels["AWS_PROFILE"] } else { "default" }
           $creds = aws sts get-session-token --profile $profile --query Credentials --output json | ConvertFrom-Json
           $body  = @{ Code="Success"; Type="AWS-HMAC"; AccessKeyId=$creds.AccessKeyId
                       SecretAccessKey=$creds.SecretAccessKey; Token=$creds.SessionToken
                       Expiration=$creds.Expiration } | ConvertTo-Json -Compress
           $ctx.Response.ContentType = "application/json"
       } elseif ($ctx.Request.RawUrl -match "metadata/identity/oauth2/token" -and $provider -eq "azure") {
           $resource = if ($ctx.Request.QueryString["resource"]) { $ctx.Request.QueryString["resource"] }
                       else { "https://management.azure.com/" }
           $clientId = $labels?["AZURE_CLIENT_ID"]
           $args     = @("account", "get-access-token", "--resource", $resource, "--output", "json")
           if ($clientId) { $args += "--client-id"; $args += $clientId }
           $token = & az @args | ConvertFrom-Json
           $body  = @{ access_token=$token.accessToken; expires_in=3599; token_type="Bearer" } | ConvertTo-Json -Compress
           $ctx.Response.ContentType = "application/json"
       } else {
           $ctx.Response.StatusCode = 404
           $ctx.Response.Close()
           continue
       }
       $bytes = [Text.Encoding]::UTF8.GetBytes($body)
       $ctx.Response.ContentLength64 = $bytes.Length
       $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
       $ctx.Response.Close()
   }
   ```

---

## Other providers

**DigitalOcean** - The DigitalOcean metadata service provides droplet info (hostname, region, tags) but does not serve credentials. Use the DigitalOcean API directly with a personal access token.

**IBM Cloud** - IBM Cloud VPC metadata uses a two-step token exchange that is not easily served by a simple script. Use the [imds-server](https://github.com/imdsutil/imds-server) project for full IBM Cloud support.

**Oracle Cloud** - Oracle instance principal authentication is certificate-based and not scriptable in this way. Use the [imds-server](https://github.com/imdsutil/imds-server) project for full Oracle Cloud support.

**Salesforce Hyperforce** - Hyperforce runs on top of AWS, GCP, and Azure. Use the recipe for whichever underlying cloud your Hyperforce environment is on.

---

## Going further

These recipes handle the most common paths. A production-grade credential server handles the full path surface - instance identity, token endpoints, IMDSv2, and more - with proper routing, caching, and error handling. The [imds-server](https://github.com/imdsutil/imds-server) project is built for exactly this.
