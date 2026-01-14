!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
  Var ImportAllCheckbox
  
  Var ImportCategoriesCheckbox
  Var ImportCategoriesState
  Var ImportTagsCheckbox
  Var ImportTagsState
  Var ImportTypesCheckbox
  Var ImportTypesState

  !macro customInit
    ; Initialize states (Checked by default)
    StrCpy $ImportCategoriesState 1
    StrCpy $ImportTagsState 1
    StrCpy $ImportTypesState 1
  !macroend

  !macro customPageAfterChangeDir
    Page custom createOptionsPage leaveOptionsPage
  !macroend

  Function createOptionsPage
    nsDialogs::Create 1018
    Pop $0
    
    ${If} $0 == error
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "Installation Options" "Choose additional settings for Jiinashi."

    ${NSD_CreateLabel} 0 0 100% 12u "Select components to include with the installation:"
    Pop $0

    ; Main Toggle
    ${NSD_CreateCheckbox} 10u 20u 90% 12u "Import all default presets (Recommended)"
    Pop $ImportAllCheckbox
    ${NSD_SetState} $ImportAllCheckbox ${BST_CHECKED}
    ${NSD_OnClick} $ImportAllCheckbox onMainChanged

    ; Categories (Indented)
    ${NSD_CreateCheckbox} 20u 40u 80% 12u "Categories (Character, Artist, etc.)"
    Pop $ImportCategoriesCheckbox
    ${NSD_SetState} $ImportCategoriesCheckbox ${BST_CHECKED}
    ${NSD_OnClick} $ImportCategoriesCheckbox onSubChanged

    ; Tags (Indented)
    ${NSD_CreateCheckbox} 20u 55u 80% 12u "Tags (~200 common presets)"
    Pop $ImportTagsCheckbox
    ${NSD_SetState} $ImportTagsCheckbox ${BST_CHECKED}
    ${NSD_OnClick} $ImportTagsCheckbox onSubChanged

    ; Types (Indented)
    ${NSD_CreateCheckbox} 20u 70u 80% 12u "Content Types (Manga, Webtoon, etc.)"
    Pop $ImportTypesCheckbox
    ${NSD_SetState} $ImportTypesCheckbox ${BST_CHECKED}
    ${NSD_OnClick} $ImportTypesCheckbox onSubChanged
    
    nsDialogs::Show
  FunctionEnd

  Function onMainChanged
    Pop $0 ; The checkbox handle
    ${NSD_GetState} $ImportAllCheckbox $1
    
    ; Sync all sub-options with main
    ${NSD_SetState} $ImportCategoriesCheckbox $1
    ${NSD_SetState} $ImportTagsCheckbox $1
    ${NSD_SetState} $ImportTypesCheckbox $1
  FunctionEnd

  Function onSubChanged
    Pop $0 ; The checkbox handle
    
    ${NSD_GetState} $ImportCategoriesCheckbox $1
    ${NSD_GetState} $ImportTagsCheckbox $2
    ${NSD_GetState} $ImportTypesCheckbox $3
    
    ${If} $1 == ${BST_CHECKED}
    ${AndIf} $2 == ${BST_CHECKED}
    ${AndIf} $3 == ${BST_CHECKED}
      ${NSD_SetState} $ImportAllCheckbox ${BST_CHECKED}
    ${Else}
      ${NSD_SetState} $ImportAllCheckbox ${BST_UNCHECKED}
    ${EndIf}
  FunctionEnd

  Function leaveOptionsPage
    ${NSD_GetState} $ImportCategoriesCheckbox $ImportCategoriesState
    ${NSD_GetState} $ImportTagsCheckbox $ImportTagsState
    ${NSD_GetState} $ImportTypesCheckbox $ImportTypesState
  FunctionEnd

  !macro customInstall
    CreateDirectory "$INSTDIR\resources"
    FileOpen $0 "$INSTDIR\resources\install-config.json" w
    
    StrCpy $1 "{"
    
    ${If} $ImportCategoriesState == ${BST_CHECKED}
      StrCpy $1 '$1"importCategories":true,'
    ${Else}
      StrCpy $1 '$1"importCategories":false,'
    ${EndIf}

    ${If} $ImportTagsState == ${BST_CHECKED}
      StrCpy $1 '$1"importTags":true,'
    ${Else}
      StrCpy $1 '$1"importTags":false,'
    ${EndIf}

    ${If} $ImportTypesState == ${BST_CHECKED}
      StrCpy $1 '$1"importTypes":true'
    ${Else}
      StrCpy $1 '$1"importTypes":false'
    ${EndIf}
    
    StrCpy $1 "$1}"
    
    FileWrite $0 $1
    FileClose $0
  !macroend
!endif
