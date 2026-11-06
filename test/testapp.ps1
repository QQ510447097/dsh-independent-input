Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @'
using System.Runtime.InteropServices;
public static class DpiTest {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[DpiTest]::SetProcessDPIAware() | Out-Null

$log = Join-Path $PSScriptRoot 'testapp.log'
$meta = Join-Path $PSScriptRoot 'testapp.json'
[System.IO.File]::WriteAllText($log, '')

$form = New-Object System.Windows.Forms.Form
$form.Text = 'DSH Input Test'
$form.AutoScaleMode = 'None'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(300, 300)
$form.Size = New-Object System.Drawing.Size(460, 300)
$form.TopMost = ($env:DSH_TESTAPP_BACKGROUND -ne '1')
$form.ShowInTaskbar = $true

$button = New-Object System.Windows.Forms.Button
$button.Text = 'Click Me'
$button.Location = New-Object System.Drawing.Point(20, 20)
$button.Size = New-Object System.Drawing.Size(180, 40)
$button.Add_Click({
  [System.IO.File]::AppendAllText($log, "button`n")
  $form.Text = 'DSH Input Test - clicked'
})

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Location = New-Object System.Drawing.Point(20, 80)
$textBox.Size = New-Object System.Drawing.Size(400, 28)

$readButton = New-Object System.Windows.Forms.Button
$readButton.Text = 'Read Text'
$readButton.Location = New-Object System.Drawing.Point(20, 130)
$readButton.Size = New-Object System.Drawing.Size(180, 40)
$readButton.Add_Click({
  [System.IO.File]::AppendAllText($log, "text=" + $textBox.Text + "`n")
})

$form.Controls.Add($button)
$form.Controls.Add($textBox)
$form.Controls.Add($readButton)

$form.Add_Shown({
  if ($env:DSH_TESTAPP_BACKGROUND -ne '1') { $form.Activate() }
  $bp = $button.PointToScreen((New-Object System.Drawing.Point(90, 20)))
  $tp = $textBox.PointToScreen((New-Object System.Drawing.Point(200, 14)))
  $rp = $readButton.PointToScreen((New-Object System.Drawing.Point(90, 20)))
  $obj = @{
    hwnd = [long]$form.Handle
    textboxHwnd = [long]$textBox.Handle
    button = @{ x = $bp.X; y = $bp.Y }
    textbox = @{ x = $tp.X; y = $tp.Y }
    read = @{ x = $rp.X; y = $rp.Y }
    rect = @{ x = $form.Left; y = $form.Top; w = $form.Width; h = $form.Height }
  }
  [System.IO.File]::WriteAllText($meta, ($obj | ConvertTo-Json -Compress))
})

$form.Show()
[System.Windows.Forms.Application]::Run($form)
