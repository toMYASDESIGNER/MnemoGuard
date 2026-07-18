[CmdletBinding()]
param(
  [string]$ScriptPath = "submission/video-script.json",
  [string]$OutputPath = "submission/mnemoguard-demo.mp4",
  [string]$SubtitlePath = "submission/mnemoguard-demo-en.srt",
  [string]$Voice = "Microsoft David Desktop",
  [ValidateRange(-10, 10)]
  [int]$VoiceRate = 0,
  [switch]$CleanupOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-RepoPath {
  param([string]$Path, [string]$RepoRoot)

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }

  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Format-SrtTime {
  param([double]$Seconds)

  $time = [TimeSpan]::FromSeconds([Math]::Max(0, $Seconds))
  return "{0:00}:{1:00}:{2:00},{3:000}" -f `
    [Math]::Floor($time.TotalHours), $time.Minutes, $time.Seconds, $time.Milliseconds
}

function Assert-LastExitCode {
  param([string]$Operation)

  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed with exit code $LASTEXITCODE."
  }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$scriptFullPath = Resolve-RepoPath -Path $ScriptPath -RepoRoot $repoRoot
$outputFullPath = Resolve-RepoPath -Path $OutputPath -RepoRoot $repoRoot
$subtitleFullPath = Resolve-RepoPath -Path $SubtitlePath -RepoRoot $repoRoot
$buildRoot = Join-Path $repoRoot ("submission/.video-build-" + [Guid]::NewGuid().ToString("N"))
$concatPath = Join-Path $buildRoot "concat.txt"
$intermediatePath = Join-Path $buildRoot "joined.mp4"
$buildSucceeded = $false

if ($CleanupOnly) {
  $submissionRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "submission")).TrimEnd('\') + '\'
  $staleBuilds = Get-ChildItem -LiteralPath $submissionRoot -Directory -Force |
    Where-Object { $_.Name -match '^\.video-build-[a-f0-9]{32}$' }

  foreach ($staleBuild in $staleBuilds) {
    $resolvedStaleBuild = [System.IO.Path]::GetFullPath($staleBuild.FullName)
    if (-not $resolvedStaleBuild.StartsWith($submissionRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove build directory outside submission: $resolvedStaleBuild"
    }
    Remove-Item -LiteralPath $resolvedStaleBuild -Recurse -Force
    Write-Host "Removed $resolvedStaleBuild"
  }
  return
}

if (-not (Test-Path -LiteralPath $scriptFullPath -PathType Leaf)) {
  throw "Video script not found: $scriptFullPath"
}

if (Test-Path -LiteralPath $outputFullPath) {
  throw "Output already exists: $outputFullPath"
}

foreach ($command in @("ffmpeg", "ffprobe")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required but was not found on PATH."
  }
}

New-Item -ItemType Directory -Path $buildRoot | Out-Null

try {
  Add-Type -AssemblyName System.Speech
  $parsedSegments = Get-Content -Raw -LiteralPath $scriptFullPath | ConvertFrom-Json
  $segments = [System.Collections.Generic.List[object]]::new()
  foreach ($parsedSegment in $parsedSegments) {
    $segments.Add($parsedSegment)
  }
  if ($segments.Count -eq 0) {
    throw "The video script contains no segments."
  }

  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $synth.SelectVoice($Voice)
    $synth.Rate = $VoiceRate
    $synth.Volume = 100

    $timeline = 0.0
    $subtitleIndex = 1
    $srtLines = [System.Collections.Generic.List[string]]::new()
    $concatLines = [System.Collections.Generic.List[string]]::new()

    for ($index = 0; $index -lt $segments.Count; $index++) {
      $segmentNumber = $index + 1
      $segment = $segments[$index]
      $imagePath = Resolve-RepoPath -Path ([string]$segment.image) -RepoRoot $repoRoot
      if (-not (Test-Path -LiteralPath $imagePath -PathType Leaf)) {
        throw "Segment image not found: $imagePath"
      }

      $wavPath = Join-Path $buildRoot ("voice-{0:00}.wav" -f $segmentNumber)
      $videoPath = Join-Path $buildRoot ("segment-{0:00}.mp4" -f $segmentNumber)
      $narration = ([string]$segment.narration).Trim()
      if (-not $narration) {
        throw "Segment $segmentNumber has no narration."
      }

      $synth.SetOutputToWaveFile($wavPath)
      $synth.Speak($narration)
      $synth.SetOutputToNull()

      $durationText = (& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $wavPath).Trim()
      Assert-LastExitCode -Operation "Audio duration probe for segment $segmentNumber"
      $audioDuration = [double]::Parse($durationText, [Globalization.CultureInfo]::InvariantCulture)
      $segmentDuration = $audioDuration + 0.35
      $fadeOut = [Math]::Max(0, $segmentDuration - 0.3)
      $durationArg = $segmentDuration.ToString("0.000", [Globalization.CultureInfo]::InvariantCulture)
      $fadeOutArg = $fadeOut.ToString("0.000", [Globalization.CultureInfo]::InvariantCulture)
      $videoFilter = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOutArg}:d=0.3"
      $audioFilter = "apad=pad_dur=0.35"

      & ffmpeg -hide_banner -loglevel error -y `
        -loop 1 -framerate 30 -i $imagePath `
        -i $wavPath -t $durationArg `
        -vf $videoFilter -af $audioFilter `
        -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -r 30 `
        -c:a aac -b:a 192k -ar 48000 -movflags +faststart $videoPath
      Assert-LastExitCode -Operation "Video render for segment $segmentNumber"

      $concatLines.Add("file '$($videoPath.Replace('\', '/').Replace("'", "''"))'")

      $sentences = @($narration -split "(?<=[.!?])\s+" | Where-Object { $_.Trim() })
      $totalCharacters = ($sentences | Measure-Object -Property Length -Sum).Sum
      $sentenceCursor = $timeline
      foreach ($sentence in $sentences) {
        $share = if ($totalCharacters -gt 0) { $sentence.Length / $totalCharacters } else { 1.0 / $sentences.Count }
        $sentenceDuration = $audioDuration * $share
        $sentenceEnd = [Math]::Min($timeline + $audioDuration, $sentenceCursor + $sentenceDuration)
        $srtLines.Add([string]$subtitleIndex)
        $srtLines.Add("$(Format-SrtTime $sentenceCursor) --> $(Format-SrtTime $sentenceEnd)")
        $srtLines.Add($sentence.Trim())
        $srtLines.Add("")
        $subtitleIndex++
        $sentenceCursor = $sentenceEnd
      }

      $timeline += $segmentDuration
      Write-Host ("Rendered segment {0}/{1}: {2:N1}s" -f $segmentNumber, $segments.Count, $segmentDuration)
    }
  }
  finally {
    if ($null -ne $synth) {
      $synth.Dispose()
    }
  }

  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllLines($concatPath, [string[]]$concatLines, $utf8NoBom)
  [System.IO.File]::WriteAllLines($subtitleFullPath, [string[]]$srtLines, $utf8NoBom)

  & ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i $concatPath -c copy -movflags +faststart $intermediatePath
  Assert-LastExitCode -Operation "Segment concatenation"

  $escapedSubtitlePath = $subtitleFullPath.Replace('\', '/').Replace(':', '\:').Replace("'", "\'")
  $subtitleFilter = "subtitles='$escapedSubtitlePath':force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BackColour=&H70000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=38,Alignment=2'"
  & ffmpeg -hide_banner -loglevel error -y -i $intermediatePath `
    -vf $subtitleFilter -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p `
    -c:a copy -movflags +faststart $outputFullPath
  Assert-LastExitCode -Operation "Subtitle burn-in"

  $finalDurationText = (& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $outputFullPath).Trim()
  Assert-LastExitCode -Operation "Final duration probe"
  $finalDuration = [double]::Parse($finalDurationText, [Globalization.CultureInfo]::InvariantCulture)
  if ($finalDuration -ge 180) {
    throw ("Final video is {0:N1}s and must be shorter than 180s." -f $finalDuration)
  }

  $buildSucceeded = $true
  Write-Host ("Created {0} ({1:N1}s)" -f $outputFullPath, $finalDuration)
  Write-Host ("Subtitles: {0}" -f $subtitleFullPath)
}
finally {
  if ($buildSucceeded -and (Test-Path -LiteralPath $buildRoot)) {
    $resolvedRepo = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\'
    $resolvedBuild = [System.IO.Path]::GetFullPath($buildRoot)
    if (-not $resolvedBuild.StartsWith($resolvedRepo, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove build directory outside repository: $resolvedBuild"
    }
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
  }
}
