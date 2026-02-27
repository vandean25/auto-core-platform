# Stitch Fetch Skill

Use this skill when you need to fetch screen metadata, image URLs, and HTML code URLs from Stitch, then download the files with `curl -L`.

## Prerequisites

1. Stitch MCP server is configured:
   - `codex mcp add stitch --url "https://stitch.googleapis.com/mcp"`
2. API key header is configured for `stitch` in Codex config (`X-Goog-Api-Key`).

## Inputs

- `project_id` (example: `14424232550416226178`)
- `screen_ids` (one or more Stitch screen IDs)
- output folder (example: `stitch-downloads/<project-name>-<project-id>`)

## Workflow

1. Verify Stitch MCP config:
   - `codex mcp get stitch`

2. (Optional) List available MCP tools:
   - Send MCP JSON-RPC request `tools/list` to `https://stitch.googleapis.com/mcp`

3. Get each screen:
   - Call MCP method `tools/call` with tool `get_screen`
   - Argument format:
     - `name: "projects/{project_id}/screens/{screen_id}"`

4. From each response, read:
   - `structuredContent.screenshot.downloadUrl`
   - `structuredContent.htmlCode.downloadUrl`

5. Download assets with `curl -L`:
   - `curl -sSL "<screenshot_url>" -o "<screen-label>-<screen-id>.png"`
   - `curl -sSL "<html_url>" -o "<screen-label>-<screen-id>.html"`

6. Save a `manifest.json` with:
   - `screen_id`, `screen_title`
   - local file paths
   - source hosted URLs
   - file sizes

## PowerShell Reference Script

```powershell
$project = "14424232550416226178"
$screens = @(
  @{ label = "workshop-order-detail-view"; id = "90d7af0e1a8e41d2b60a6203e70183e4" },
  @{ label = "workshop-order-job-detail-view"; id = "cbdc664b013f421d9af15569f5bfef46" }
)

$outDir = "stitch-downloads/workshop-order-job-detail-view-$project"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Read API key from ~/.codex/config.toml
$cfg = Join-Path $env:USERPROFILE ".codex\config.toml"
$raw = Get-Content $cfg -Raw
$key = [regex]::Match($raw, '"X-Goog-Api-Key"\s*=\s*"([^"]+)"').Groups[1].Value
if (-not $key) { throw "X-Goog-Api-Key not found in ~/.codex/config.toml" }

$manifest = @()
$reqId = 100

foreach ($s in $screens) {
  $screenName = "projects/$project/screens/$($s.id)"
  $payload = @{
    jsonrpc = "2.0"
    id      = $reqId
    method  = "tools/call"
    params  = @{
      name      = "get_screen"
      arguments = @{ name = $screenName }
    }
  } | ConvertTo-Json -Compress -Depth 10

  $resp = curl.exe -sS -X POST "https://stitch.googleapis.com/mcp" `
    -H "Content-Type: application/json" `
    -H "Accept: application/json, text/event-stream" `
    -H "X-Goog-Api-Key: $key" `
    --data-binary $payload

  $obj = $resp | ConvertFrom-Json
  $title = $obj.result.structuredContent.title
  $imgUrl = $obj.result.structuredContent.screenshot.downloadUrl
  $htmlUrl = $obj.result.structuredContent.htmlCode.downloadUrl

  $imgOut = Join-Path $outDir "$($s.label)-$($s.id).png"
  $htmlOut = Join-Path $outDir "$($s.label)-$($s.id).html"

  curl.exe -sSL "$imgUrl" -o "$imgOut"
  curl.exe -sSL "$htmlUrl" -o "$htmlOut"

  $manifest += [pscustomobject]@{
    screen_id = $s.id
    screen_title = $title
    image_file = (Resolve-Path $imgOut).Path
    code_file = (Resolve-Path $htmlOut).Path
    image_size = (Get-Item $imgOut).Length
    code_size = (Get-Item $htmlOut).Length
    image_url = $imgUrl
    code_url = $htmlUrl
  }

  $reqId++
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $outDir "manifest.json")
Write-Output "Done. Files saved to: $outDir"
```

## Notes

- Stitch hosted URLs can expire. If a downloaded file is empty, call `get_screen` again and re-download.
- Keep API keys out of repo files. Use local user config or environment variables.
