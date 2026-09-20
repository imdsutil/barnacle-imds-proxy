# Recipes

Minimal credential servers you can run locally alongside the extension. Each listens on a port, receives forwarded IMDS requests from the extension, reads container labels from the `x-container-labels` header, and responds in the format the cloud SDK expects.

Point the extension at `http://localhost:<port>` in the Settings tab.

---

## AWS

Handles credentials and region in one server. Reads `AWS_PROFILE` and `AWS_DEFAULT_REGION` labels from the requesting container. If a label is not set, both values fall back to host environment values. Requires the AWS CLI and `jq`.

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
   while true; do
     {
       # Read the HTTP request line (e.g. "GET /latest/meta-data/... HTTP/1.1")
       read -r line
       PATH_REQ=$(echo "$line" | awk '{print $2}')

       # Read headers until the blank line that ends the HTTP header block
       while IFS= read -r h && [ "$h" != $'\r' ]; do
         # ${h,,} lowercases the header name for case-insensitive matching
         [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
       done

       PROFILE=$(echo "$LABELS" | jq -r '.AWS_PROFILE // "default"')
       REGION=$(echo "$LABELS" | jq -r '.AWS_DEFAULT_REGION // empty')
       REGION=${REGION:-${AWS_DEFAULT_REGION:-us-east-1}}

       if [[ "$PATH_REQ" == */placement/region ]]; then
         printf "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${#REGION}\r\nConnection: close\r\n\r\n$REGION"
       else
         CREDS=$(AWS_PROFILE=$PROFILE aws sts get-session-token --query Credentials --output json)
         BODY=$(echo "$CREDS" | jq -c '{Code:"Success",Type:"AWS-HMAC",
           AccessKeyId:.AccessKeyId,SecretAccessKey:.SecretAccessKey,
           Token:.SessionToken,Expiration:.Expiration}')
         printf "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n$BODY"
       fi
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
   Write-Host "AWS IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx = $listener.GetContext()
       $labels = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $profile = if ($labels?["AWS_PROFILE"]) { $labels["AWS_PROFILE"] } else { "default" }
       $region  = if ($labels?["AWS_DEFAULT_REGION"]) { $labels["AWS_DEFAULT_REGION"] }
                  elseif ($env:AWS_DEFAULT_REGION) { $env:AWS_DEFAULT_REGION }
                  else { "us-east-1" }
       if ($ctx.Request.RawUrl -match "placement/region") {
           $bytes = [Text.Encoding]::UTF8.GetBytes($region)
           $ctx.Response.ContentType = "text/plain"
       } else {
           $creds = aws sts get-session-token --profile $profile --query Credentials --output json | ConvertFrom-Json
           $body  = @{ Code="Success"; Type="AWS-HMAC"; AccessKeyId=$creds.AccessKeyId
                       SecretAccessKey=$creds.SecretAccessKey; Token=$creds.SessionToken
                       Expiration=$creds.Expiration } | ConvertTo-Json -Compress
           $bytes = [Text.Encoding]::UTF8.GetBytes($body)
           $ctx.Response.ContentType = "application/json"
       }
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

Serves the GCE metadata endpoints that Google SDKs request: the detection probe, the access token, the service account details, and the project ID. Returns a token for the service account named in the container's `GCP_SERVICE_ACCOUNT` label. If the label is not set, falls back to the active `gcloud` account. Requires the `gcloud` CLI, `jq`, and `socat`.

Every response carries the `Metadata-Flavor: Google` header. Google clients check this header to confirm they reached a real metadata server. Without it, detection fails and the client never asks for a token.

Google SDKs written in Python, including `gcloud`, also need a host entry on the container. See [Providers that also need a host entry](../README.md#providers-that-also-need-a-host-entry).

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
   # socat keeps listening and forks one handler per connection. A one-shot nc loop
   # is unreachable while it rebinds, which breaks SDKs that make several calls in a
   # row, and Google clients make several.
   if [ "$1" != "--handle" ]; then
     exec socat TCP-LISTEN:$PORT,reuseaddr,fork SYSTEM:"bash $(realpath "$0") --handle"
   fi

   # Everything below runs once per request, with the socket on stdin and stdout.
   # Read the HTTP request line (e.g. "GET /computeMetadata/v1/... HTTP/1.1")
   read -r line
   PATH_REQ=$(echo "$line" | awk '{print $2}')

   # Read headers until the blank line that ends the HTTP header block
   while IFS= read -r h && [ "$h" != $'\r' ]; do
     # ${h,,} lowercases the header name for case-insensitive matching
     [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
   done

   SA=$(echo "$LABELS" | jq -r '.GCP_SERVICE_ACCOUNT // empty')
   STATUS="200 OK"
   CTYPE="text/plain"
   BODY=""

   case "$PATH_REQ" in
     # Google clients probe / first to confirm they reached a metadata server
     /)
       ;;
     */service-accounts/default/token*)
       # ${SA:+--impersonate-service-account=$SA} expands to nothing if SA is unset
       TOKEN=$(gcloud auth print-access-token ${SA:+--impersonate-service-account=$SA})
       BODY="{\"access_token\":\"$TOKEN\",\"expires_in\":3599,\"token_type\":\"Bearer\"}"
       CTYPE="application/json"
       ;;
     */service-accounts/default/*recursive=true*)
       # The email field is required; google-auth fails without it
       EMAIL=${SA:-$(gcloud config get-value account)}
       BODY="{\"aliases\":[\"default\"],\"email\":\"$EMAIL\",\"scopes\":[\"https://www.googleapis.com/auth/cloud-platform\"]}"
       CTYPE="application/json"
       ;;
     */project/project-id*)
       BODY=$(gcloud config get-value project)
       ;;
     *)
       STATUS="404 Not Found"
       ;;
   esac
   printf "HTTP/1.1 $STATUS\r\nMetadata-Flavor: Google\r\nContent-Type: $CTYPE\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n$BODY"
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
       $ctx    = $listener.GetContext()
       $labels = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $sa     = $labels?["GCP_SERVICE_ACCOUNT"]
       $url    = $ctx.Request.RawUrl
       # Google clients check this header to confirm they reached a metadata server
       $ctx.Response.Headers.Add("Metadata-Flavor", "Google")
       if ($url -eq "/") {
           # Google clients probe / first to confirm they reached a metadata server
           $body = ""
           $ctx.Response.ContentType = "text/plain"
       } elseif ($url -match "service-accounts/default/token") {
           $token = if ($sa) { gcloud auth print-access-token --impersonate-service-account=$sa }
                    else { gcloud auth print-access-token }
           $body  = @{ access_token=$token.Trim(); expires_in=3599; token_type="Bearer" } | ConvertTo-Json -Compress
           $ctx.Response.ContentType = "application/json"
       } elseif ($url -match "service-accounts/default/.*recursive=true") {
           # The email field is required; google-auth fails without it
           $email = if ($sa) { $sa } else { (gcloud config get-value account).Trim() }
           $body  = @{ aliases=@("default"); email=$email
                       scopes=@("https://www.googleapis.com/auth/cloud-platform") } | ConvertTo-Json -Compress
           $ctx.Response.ContentType = "application/json"
       } elseif ($url -match "project/project-id") {
           $body = (gcloud config get-value project).Trim()
           $ctx.Response.ContentType = "text/plain"
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

## Alibaba Cloud

Returns RAM role credentials. Reads the `ALIBABA_ROLE` label to select which RAM role to assume. Requires the `aliyun` CLI.

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
   while true; do
     {
       # Discard the request line; credentials are returned for any path
       read -r _req

       # Read headers until the blank line that ends the HTTP header block
       while IFS= read -r h && [ "$h" != $'\r' ]; do
         # ${h,,} lowercases the header name for case-insensitive matching
         [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
       done

       ROLE_ARN=$(echo "$LABELS" | jq -r '.ALIBABA_ROLE_ARN // empty')
       CREDS=$(aliyun sts AssumeRole --RoleArn "$ROLE_ARN" --RoleSessionName barnacle-session --output json)
       BODY=$(echo "$CREDS" | jq -c '.Credentials | {Code:"Success",AccessKeyId:.AccessKeyId,
         AccessKeySecret:.AccessKeySecret,SecurityToken:.SecurityToken,Expiration:.Expiration}')
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
   Write-Host "Alibaba Cloud IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx     = $listener.GetContext()
       $labels  = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $roleArn = $labels?["ALIBABA_ROLE_ARN"]
       $creds   = aliyun sts AssumeRole --RoleArn $roleArn --RoleSessionName barnacle-session --output json | ConvertFrom-Json
       $body    = @{ Code="Success"; AccessKeyId=$creds.Credentials.AccessKeyId
                     AccessKeySecret=$creds.Credentials.AccessKeySecret
                     SecurityToken=$creds.Credentials.SecurityToken
                     Expiration=$creds.Credentials.Expiration } | ConvertTo-Json -Compress
       $bytes = [Text.Encoding]::UTF8.GetBytes($body)
       $ctx.Response.ContentType = "application/json"
       $ctx.Response.ContentLength64 = $bytes.Length
       $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
       $ctx.Response.Close()
   }
   ```

---

## Tencent Cloud

Returns CAM role credentials. Reads the `TENCENT_ROLE` label to select which CAM role to use. Requires the `tccli` CLI.

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
   while true; do
     {
       # Discard the request line; credentials are returned for any path
       read -r _req

       # Read headers until the blank line that ends the HTTP header block
       while IFS= read -r h && [ "$h" != $'\r' ]; do
         # ${h,,} lowercases the header name for case-insensitive matching
         [[ "${h,,}" == x-container-labels:* ]] && LABELS="${h#*: }"
       done

       ROLE=$(echo "$LABELS" | jq -r '.TENCENT_ROLE // empty')
       # Look up the caller's UIN (account ID) to construct the full role ARN
       CREDS=$(tccli sts AssumeRole --RoleArn "qcs::cam::uin/$(tccli sts GetCallerIdentity --output json | jq -r '.UserId'):roleName/$ROLE" --RoleSessionName barnacle-session --output json)
       BODY=$(echo "$CREDS" | jq -c '.Credentials | {Code:"Success",TmpSecretId:.TmpSecretId,
         TmpSecretKey:.TmpSecretKey,Token:.Token,ExpiredTime:(.ExpiredTime|tostring)}')
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
   Write-Host "Tencent Cloud IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx    = $listener.GetContext()
       $labels = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $role   = $labels?["TENCENT_ROLE"]
       # Look up the caller's UIN to construct the full role ARN
       $uid    = tccli sts GetCallerIdentity --output json | ConvertFrom-Json | Select-Object -ExpandProperty UserId
       $arn    = "qcs::cam::uin/${uid}:roleName/$role"
       $creds  = tccli sts AssumeRole --RoleArn $arn --RoleSessionName barnacle-session --output json | ConvertFrom-Json
       $body   = @{ Code="Success"; TmpSecretId=$creds.Credentials.TmpSecretId
                    TmpSecretKey=$creds.Credentials.TmpSecretKey
                    Token=$creds.Credentials.Token
                    ExpiredTime=$creds.Credentials.ExpiredTime } | ConvertTo-Json -Compress
       $bytes = [Text.Encoding]::UTF8.GetBytes($body)
       $ctx.Response.ContentType = "application/json"
       $ctx.Response.ContentLength64 = $bytes.Length
       $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
       $ctx.Response.Close()
   }
   ```

---

## Multi-cloud (AWS + Azure)

One server handles both AWS and Azure. It routes by the `CLOUD_PROVIDER` container label; each container declares which provider it needs. Extend the pattern to add more providers.

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
   while true; do
     {
       # Read the HTTP request line and extract path for provider routing
       read -r line
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

       if [[ "$PATH_REQ" == */placement/region ]]; then
         REGION=$(echo "$LABELS" | jq -r '.AWS_DEFAULT_REGION // empty')
         BODY=${REGION:-${AWS_DEFAULT_REGION:-us-east-1}}
         CTYPE="text/plain"
       elif [[ "$PATH_REQ" == */iam/security-credentials* && "$PROVIDER" == "aws" ]]; then
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
   Write-Host "Multi-cloud IMDS server listening on port $port"
   while ($listener.IsListening) {
       $ctx      = $listener.GetContext()
       $labels   = $ctx.Request.Headers["x-container-labels"] | ConvertFrom-Json -AsHashtable
       $provider = if ($labels?["CLOUD_PROVIDER"]) { $labels["CLOUD_PROVIDER"] } else { "aws" }
       if ($ctx.Request.RawUrl -match "placement/region") {
           $body = if ($labels?["AWS_DEFAULT_REGION"]) { $labels["AWS_DEFAULT_REGION"] }
                   elseif ($env:AWS_DEFAULT_REGION) { $env:AWS_DEFAULT_REGION }
                   else { "us-east-1" }
           $ctx.Response.ContentType = "text/plain"
       } elseif ($ctx.Request.RawUrl -match "iam/security-credentials" -and $provider -eq "aws") {
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
