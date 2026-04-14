' --- ACHILLES-PROMPTFLUX stage2 metamorphic variant (benign) ---
' Simulates the "Thinging" module's hourly rewrite: same semantic
' intent as stage1, different variable names, different Chr() offsets,
' different concatenation order. Blue-team detections relying on a
' fixed string hash or YARA string constant will miss; detections
' relying on behaviour (wscript spawned from c:\F0 writing to c:\F0
' and echoing a marker) will still fire.

Dim kB2C, mX8D, pQ4E, rT7F, sV5G, uW1H
Dim zP9J, zN3M, zK6R

kB2C = Chr(65 + 0) & Chr(67) & Chr(72) & Chr(73) & Chr(76) & Chr(76) & Chr(69) & Chr(83) & Chr(45)
mX8D = Chr(80) & Chr(82) & Chr(79) & Chr(77) & Chr(80) & Chr(84) & Chr(70) & Chr(76) & Chr(85) & Chr(88)
pQ4E = Chr(45) & Chr(83) & Chr(84) & Chr(65) & Chr(71) & Chr(69) & Chr(50)
rT7F = Chr(45) & Chr(77) & Chr(69) & Chr(84) & Chr(65) & Chr(77) & Chr(79) & Chr(82) & Chr(80) & Chr(72) & Chr(73) & Chr(67)
sV5G = Chr(45) & Chr(69) & Chr(88) & Chr(69) & Chr(67)
uW1H = kB2C & mX8D & pQ4E & rT7F & sV5G

zP9J = Chr(99) & Chr(58) & Chr(92) & Chr(70) & Chr(48) & Chr(92)
zN3M = Chr(112) & Chr(114) & Chr(111) & Chr(109) & Chr(112) & Chr(116) & Chr(102) & Chr(108) & Chr(117) & Chr(120) & Chr(95) & Chr(115) & Chr(116) & Chr(97) & Chr(103) & Chr(101) & Chr(50) & Chr(95) & Chr(109) & Chr(97) & Chr(114) & Chr(107) & Chr(101) & Chr(114) & Chr(46) & Chr(116) & Chr(120) & Chr(116)
zK6R = zP9J & zN3M

Dim fso, tf
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FolderExists(zP9J) Then
    On Error Resume Next
    fso.CreateFolder(zP9J)
    On Error GoTo 0
End If

Set tf = fso.CreateTextFile(zK6R, True)
tf.WriteLine uW1H & Chr(32) & Chr(64) & Chr(32) & Now()
tf.Close

WScript.Echo uW1H
