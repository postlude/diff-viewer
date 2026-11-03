# Diff Viewer

VS Code / Cursor에서 모든 파일의 Git diff를 한 화면에 이어서 확인하는 개인용 확장입니다. 커밋 메시지나 Conventional Commits 기능은 포함하지 않습니다.

## 실행 및 설치

- 개발 실행: 이 폴더를 VS Code/Cursor로 열고 `F5` → `Run Diff Viewer`를 실행합니다.
- VSIX 빌드: `corepack yarn install` 후 `corepack yarn build`를 실행합니다.
- 설치: 명령 팔레트에서 `Extensions: Install from VSIX...` → `diff-viewer-0.1.0.vsix`를 선택합니다.
- 사용: Git 저장소를 열고 명령 팔레트에서 `Diff Viewer: Open`을 실행합니다. Source Control 제목 영역의 diff 아이콘으로도 열 수 있습니다.

Yarn Berry 4.9.2를 사용하며 `.yarnrc.yml`에서 `nodeLinker: node-modules`로 설정합니다. Corepack이 있다면 별도 전역 Yarn 설치 없이 위 명령을 사용할 수 있습니다. `corepack enable`로 Yarn 명령을 활성화한 환경에서는 `yarn install`, `yarn build`로도 실행할 수 있습니다.

확장 실행 코드에는 외부 런타임 의존성이 없으므로 VSIX 패키징에서는 의존성 자동 수집을 생략합니다. 개발 의존성은 `yarn install`로 설치합니다.

## 화면과 조작

- 우측 미리보기 없이 Staged / Unstaged 영역에 파일별 diff를 연속 표시합니다.
- Staged 파일은 기본적으로 접힙니다. Stage / Stage all / Stage hunk 성공 후에도 해당 Staged 파일이 접힙니다.
- 파일 헤더의 화살표, 변경 수치, 빈 공간: 클릭하여 개별 파일 접기·펼치기. 파일명은 클릭하면 Diff Viewer와 같은 에디터 그룹에서 엽니다. Stage/Unstage/Discard 버튼은 각 작업을 실행합니다. STAGED FILES / UNSTAGED FILES 제목 줄을 클릭하면 파일 목록을 유지하면서 해당 영역의 모든 파일 diff를 접거나 펼칩니다.
- Hunk 헤더 / 줄 번호: 해당 줄로 이동합니다. Staged 줄 번호는 Unstaged 변경을 반영해 작업 파일의 줄 번호로 변환합니다.
- Hunk 하단 막대: 드래그하여 높이 조절. 더블클릭하면 기본 높이로 복원합니다. 키보드로 막대에 포커스를 두고 위·아래 화살표로도 조절할 수 있습니다.
- 파일·Hunk 단위 Stage / Unstage / Discard와 전체 파일 작업을 제공합니다. Discard는 확인 대화상자가 표시됩니다. 추적 파일의 Discard는 index의 staged 내용을 보존합니다. Untracked 파일은 휴지통으로 이동합니다.
- Git 상태 변경과 파일 저장 시 자동 갱신합니다. 필요하면 Refresh를 누릅니다.

## 패턴으로 초기 접힘 설정

상단 `Collapse patterns` 버튼 또는 설정에서 `diffViewer.initialCollapsePatterns`를 편집합니다. `*`는 파일명 내 임의 문자, `**`는 경로를 포함한 임의 문자와 일치합니다. `/` 없는 패턴은 어느 폴더의 파일명에도 적용됩니다.

```json
{
  "diffViewer.initialCollapsePatterns": [
    "*.dto.ts",
    "*.snap",
    "generated/**"
  ],
  "diffViewer.contextLines": 3
}
```

초기 접힘 규칙은 화면을 새로 열거나 새 파일이 나타날 때 적용됩니다. 현재 화면에서 수동으로 펼친 상태는 갱신 시 유지됩니다. 파일과 Hunk의 높이·접힘 상태는 해당 화면에서 유지됩니다.

## 확인 및 제한

`corepack yarn test`는 임시 Git 저장소에서 부분 Stage/Unstage/Discard, 첫 커밋 전 저장소, 한글·공백·특수문자 파일명, 삭제 파일, 바이너리 및 빈 파일과 줄 번호 변환을 검증합니다. `corepack yarn check`는 JavaScript 문법을 확인합니다.

바이너리·빈 파일·권한 변경 등 텍스트 Hunk가 없는 변경은 파일 단위로 조작합니다. Rename/Copy는 파일 단위 작업만 지원합니다. 충돌 파일은 편집기에서 해결 후 Git Source Control에서 Stage합니다. 매우 큰 diff는 파일당 32 MB 제한이 있으며 편집기로 열어 확인할 수 있습니다. 실제 Extension Host에서의 최종 화면과 조작은 설치 후 확인해야 합니다.

기존 `git-tools`의 Stage/Unstage 화면과 조작을 참고하여 독립 구현했습니다.
