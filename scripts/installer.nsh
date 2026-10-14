; Preserve the existing executable, install path, shortcut names and APP_GUID.
; Only visible installer text and the initial interface preference are localized.
!define MUI_LANGDLL_ALWAYSSHOW
!define MUI_LANGDLL_ALLLANGUAGES
!define MUI_LANGDLL_WINDOWTITLE "Orange Schedule / 橙子日程"
!define MUI_LANGDLL_INFO "Please select a language. / 请选择语言。"

!macro customHeader
  LangString OrangeScheduleProductName ${LANG_ENGLISH} "Orange Schedule"
  LangString OrangeScheduleProductName ${LANG_SIMPCHINESE} "橙子日程"
  ; common.nsh already supplies a Name. This replacement is intentional;
  ; keep all other compiler warnings enabled (electron-builder uses /WX).
  !pragma warning push
  !pragma warning disable 6029
  Name "$(OrangeScheduleProductName)"
  BrandingText "$(OrangeScheduleProductName) ${VERSION}"
  !pragma warning pop
!macroend

!macro orangeScheduleReadLanguage
  Push $0
  Push $1
  ; The application is x64. Use the same registry view before and after
  ; electron-builder's own check64BitAndSetRegView initialization.
  SetRegView 64
  ReadRegStr $0 HKCU "Software\${APP_GUID}" "InstallerLanguage"
  ${If} $0 != "1033"
  ${AndIf} $0 != "2052"
    ReadRegStr $0 HKLM "Software\${APP_GUID}" "InstallerLanguage"
  ${EndIf}
  ${If} $0 == "1033"
  ${OrIf} $0 == "2052"
    StrCpy $LANGUAGE $0
  ${EndIf}

  ; /LANGUAGE is an app-supported argument, not a built-in NSIS option.
  ; In interactive mode it sets the default; the dialog can still change it.
  ; /S /LANGUAGE=1033 or /S /LANGUAGE=2052 selects a language without a dialog.
  ${GetParameters} $0
  StrCpy $1 ""
  ClearErrors
  ${GetOptions} $0 "/LANGUAGE=" $1
  ${If} $1 == "1033"
  ${OrIf} $1 == "2052"
    StrCpy $LANGUAGE $1
  ${EndIf}
  ClearErrors
  Pop $1
  Pop $0
!macroend

!macro preInit
  !ifndef BUILD_UNINSTALLER
    Var /GLOBAL orangeScheduleRestoreInteractive
    StrCpy $orangeScheduleRestoreInteractive "0"
    ${If} ${UAC_IsInnerInstance}
      ; Elevation creates a second process. Keep the selection from the first
      ; process and skip only its duplicate language dialog, not the wizard.
      !insertmacro UAC_AsUser_GetGlobal $LANGUAGE $LANGUAGE
      ${IfNot} ${Silent}
        StrCpy $orangeScheduleRestoreInteractive "1"
        SetSilent silent
      ${EndIf}
    ${Else}
      !insertmacro orangeScheduleReadLanguage
    ${EndIf}
  !endif
!macroend

!macro customInit
  ${If} $orangeScheduleRestoreInteractive == "1"
    SetSilent normal
  ${EndIf}
!macroend

!macro customUnInit
  !insertmacro orangeScheduleReadLanguage
!macroend

!macro customInstall
  Push $0
  ; SHELL_CONTEXT follows the chosen per-user/per-machine install mode.
  WriteRegStr SHELL_CONTEXT "Software\${APP_GUID}" "InstallerLanguage" $LANGUAGE
  ClearErrors
  FileOpen $0 "$INSTDIR\resources\installer-language.json" w
  ${IfNot} ${Errors}
    ${If} $LANGUAGE == ${LANG_SIMPCHINESE}
      FileWrite $0 '{"language":"zh-CN"}$\r$\n'
    ${Else}
      FileWrite $0 '{"language":"en"}$\r$\n'
    ${EndIf}
    FileClose $0
  ${EndIf}
  Pop $0
!macroend
