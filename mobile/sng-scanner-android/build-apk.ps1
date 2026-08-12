$ErrorActionPreference = 'Stop'

$projectDir = $PSScriptRoot
$javaDir = 'C:\Program Files\Android\Android Studio\jbr'
$androidSdkDir = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$driveName = @('Z:', 'Y:', 'X:', 'W:') | Where-Object { -not (Test-Path "$_\") } | Select-Object -First 1

if (-not $driveName) { throw 'No free temporary drive letter is available for the Android build.' }
if (-not (Test-Path (Join-Path $javaDir 'bin\java.exe'))) { throw "JDK not found: $javaDir" }
if (-not (Test-Path (Join-Path $androidSdkDir 'platforms\android-34\android.jar'))) { throw "Android SDK 34 not found: $androidSdkDir" }

& subst.exe $driveName $projectDir
try {
    $env:JAVA_HOME = $javaDir
    $env:ANDROID_HOME = $androidSdkDir
    $env:ANDROID_SDK_ROOT = $androidSdkDir
    $mappedProject = "$driveName\"
    & "$mappedProject\gradlew.bat" -p $mappedProject --no-daemon --console=plain testDebugUnitTest lintDebug assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Android build failed with exit code $LASTEXITCODE" }
} finally {
    & subst.exe $driveName /D
}

Write-Host 'APK: app\build\outputs\apk\debug\app-debug.apk'
