# RFC — Versionamento, Branching e Releases (Java)

**Status:** Draft • **Data:** 2025-08-17 • **Escopo:** Java + Maven • **Registro:** GHCR

---

## 1. Objetivo

Padronizar:

* branches (Git Flow),
* cálculo de versão `X.Y.N`,
* geração de imagens Docker,
* changelog (apenas no merge para `master/main`),
* ordem/dependência entre workflows (GitHub Actions).

---

## 2. Estratégia de Branches

```
master/main          → produção (tags vX.Y.Z)
develop              → integração contínua
release/X.Y.0        → estabilização
hotfix/X.Y.Z         → correções críticas
feature/*            → novas funcionalidades
bugfix/*             → correções não críticas
```

**Políticas:**

* `release/*` e `hotfix/*`: **proibido** rebase/merge/squash/force-push. Somente commits diretos + cherry-pick.
* `master/main`/`develop`: **apenas** squash merge (histórico linear), PR obrigatório, commits assinados.

---

## 3. Versionamento

* **SemVer.** Versão base da release é o sufixo da branch (`release/1.10.0` ⇒ `1.10.0`).
* **Âncora:** criar tag anotada `release-base/X.Y.0` (ou `hotfix-base/X.Y.Z`) **na criação da branch**.
* **Patch contador `N`:** `N = commits (exclusivos) desde a âncora`. Versão efetiva = `X.Y.N`.

  * Ex.: base `1.10.0`, 3 commits → `1.10.3`.

> Opcional (robustez): gravar `.version.json` com `{ base, anchor_sha, branch }` ao criar a release; `anchor_sha..HEAD` passa a ser a fonte para `N`.

---

## 4. Tagging de Imagens Docker

**Placeholders obrigatórios:**

* `REGISTRY` (ex.: `ghcr.io`)
* `IMAGE` (ex.: `my-org/my-service`)

**Regras:**

* `develop`: `${REGISTRY}/${IMAGE}:develop-${{ github.run_number }}`
* `release/*` e `hotfix/*`: `${REGISTRY}/${IMAGE}:X.Y.N`
* `master/main` (merge da release): publicar **duas** tags no mesmo push → `${REGISTRY}/${IMAGE}:latest` **e** `${REGISTRY}/${IMAGE}:X.Y.Z`

---

## 5. Changelog (Conventional Commits)

* **Gerado apenas no merge para `master`.**
* **Ordem obrigatória** para cabeçalho com versão:

  * `changelog → commit → tag vX.Y.Z → push` **(recomendado)**, ou
  * `tag → changelog → commit → retag -f vX.Y.Z → push`.
* Preset: `conventionalcommits`.
  Opcional: `.changelogrc.json` para exibir tipos adicionais (pt-BR):

```json
{
  "releaseCount": 0,
  "types": [
    { "type": "feat",     "section": "Novidades" },
    { "type": "fix",      "section": "Correções" },
    { "type": "perf",     "section": "Desempenho" },
    { "type": "revert",   "section": "Reversões" },
    { "type": "ci",       "section": "CI/CD",       "hidden": false },
    { "type": "chore",    "section": "Manutenção",  "hidden": false },
    { "type": "build",    "section": "Build",       "hidden": false },
    { "type": "refactor", "section": "Refatoração", "hidden": false },
    { "type": "style",    "section": "Estilo",      "hidden": false },
    { "type": "test",     "section": "Testes",      "hidden": false }
  ]
}
```

---

## 6. Workflows (arquivos e responsabilidades) — **Exemplos**

> **Arquivos vigentes**: `build-and-test.yml`, `develop-docker.yml`, `on-new-release-branch.yml`, `on-release-patch.yml`, `ready-for-production.yml`.
> Os exemplos abaixo usam imagem **genérica** (`IMAGE: my-org/my-service`).

### 6.1 `build-and-test.yml`

```yaml
name: build-and-test
on:
  pull_request:
    branches: [develop, master]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '24'
      - name: Build & Test
        run: mvn -B -Dmaven.test.failure.ignore=false verify
```

**Função:** build, testes, lint/scan. **Status check obrigatório** para merges.

---

### 6.2 `develop-docker.yml`

```yaml
name: develop-docker
on:
  push:
    branches: [develop]
permissions:
  contents: read
  packages: write
env:
  REGISTRY: ghcr.io
  IMAGE: my-org/my-service
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '24'
      - run: mvn -B -DskipTests package
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE }}:develop-${{ github.run_number }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
```

**Saída:** `${REGISTRY}/${IMAGE}:develop-${{ github.run_number }}`.

---

### 6.3 `on-new-release-branch.yml`

```yaml
name: on-new-release-push
on:
  create:
    branches: ['release/*','hotfix/*']

permissions:
  contents: write
concurrency:
  group: rel-${{ github.ref }}
  cancel-in-progress: false

jobs:
  bump-and-create-anchor-tag:
    if: github.event.ref_type == 'branch' && (startsWith(github.event.ref, 'release/') || startsWith(github.event.ref, 'hotfix/'))
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '24' }

      - name: Bump X.Y.0 + anchor tag (release|hotfix)-base/X.Y.0
        shell: bash
        run: |
          set -euo pipefail
          CURRENT_BRANCH="${GITHUB_REF_NAME}"              # ex: release/1.10.0
          NEW_VERSION="${CURRENT_BRANCH#*/}"                       # 1.10.0
          KIND="${CURRENT_BRANCH%%/*}"                     # release|hotfix

          mvn -q versions:set -DnewVersion="$NEW_VERSION" -DprocessAllModules=true -DgenerateBackupPoms=false
          mvn -q versions:commit

          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -A
          git commit -m "chore: init $NEW_VERSION [skip ci]"
          git tag -a "${KIND}-base/$NEW_VERSION" -m "anchor $NEW_VERSION"
          git push --follow-tags

```

**Passos:** bump `pom.xml` → commit `[skip ci]` → **tag âncora**.

---

### 6.4 `on-release-patch.yml`

```yaml
name: on-release-patch
on:
  push:
    branches: ['release/*', 'hotfix/*']
permissions:
  contents: write
  packages: write
concurrency:
  group: rel-${{ github.ref }}
  cancel-in-progress: true
env:
  REGISTRY: ghcr.io
  IMAGE: my-org/my-service
jobs:
  patch:
    runs-on: ubuntu-latest
    if: "!contains(github.event.head_commit.message, '[skip ci]')"
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '24'
      - name: Guard âncora
        id: guard
        shell: bash
        run: |
          BR=${GITHUB_REF_NAME}; BASE=${BR#*/}; KIND=${BR%%/*}
          git fetch --tags --quiet
          if git rev-parse -q --verify "refs/tags/${KIND}-base/${BASE}" >/dev/null; then
            echo ok=1 >>$GITHUB_OUTPUT
          else
            echo ok=0 >>$GITHUB_OUTPUT
          fi
      - name: Sync branch (FF)
        if: steps.guard.outputs.ok == '1'
        run: |
          git fetch origin $GITHUB_REF_NAME --tags --quiet
          git merge --ff-only origin/$GITHUB_REF_NAME || true
      - name: Compute X.Y.N
        if: steps.guard.outputs.ok == '1'
        id: ver
        shell: bash
        run: |
          BR=${GITHUB_REF_NAME}; BASE=${BR#*/}; KIND=${BR%%/*}
          COUNT=$(git rev-list --count "${KIND}-base/${BASE}..HEAD")
          MAJOR=${BASE%%.*}; MINOR=$(echo $BASE|cut -d. -f2)
          echo exp=$MAJOR.$MINOR.$COUNT >>$GITHUB_OUTPUT
      - name: Bump pom.xml (se necessário)
        if: steps.guard.outputs.ok == '1'
        id: sync
        run: |
          EXP=${{ steps.ver.outputs.exp }}
          CUR=$(mvn -q -DforceStdout -Dexpression=project.version -DnonRecursive=true help:evaluate)
          if [ "$CUR" != "$EXP" ]; then
            mvn -q versions:set -DnewVersion="$EXP" -DprocessAllModules=true -DgenerateBackupPoms=false
            mvn -q versions:commit
            git config user.name  "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git commit -am "chore(version): $EXP [skip ci]"
            git push
          fi
      - name: Build JAR
        if: steps.guard.outputs.ok == '1'
        run: mvn -B -DskipTests package
      - name: Push Docker X.Y.N
        if: steps.guard.outputs.ok == '1'
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE }}:${{ steps.ver.outputs.exp }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
```

**Resultado:** bump incremental, build e publicação de `${REGISTRY}/${IMAGE}:X.Y.N`.

---

### 6.5 `ready-for-production.yml`

```yaml
name: ready-for-production
on:
  push:
    branches: [master]
permissions:
  contents: write
  packages: write
env:
  REGISTRY: ghcr.io
  IMAGE: my-org/my-service
jobs:
  release-merge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          fetch-tags: true
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm i -g conventional-changelog-cli@2 conventional-changelog-conventionalcommits@6
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '24'
      - id: ver
        run: |
          V=$(mvn -q -DforceStdout -Dexpression=project.version -DnonRecursive=true help:evaluate)
          echo version=$V >>$GITHUB_OUTPUT
      - name: Changelog → commit → tag
        run: |
          set -e
          V=${{ steps.ver.outputs.version }}
          git fetch --tags --force --prune
          npx conventional-changelog -n ./.changelogrc.json -i CHANGELOG.md -s -r 0 || \
            npx conventional-changelog -p conventionalcommits -i CHANGELOG.md -s -r 0
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add CHANGELOG.md
          git commit -m "docs(changelog): $V [skip ci]" || true
          git tag -a "v$V" -m "release $V"
          git push --follow-tags
      - run: mvn -B -DskipTests package
      - name: Push Docker latest & versão
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE }}:${{ steps.ver.outputs.version }}
            ${{ env.REGISTRY }}/${{ env.IMAGE }}:latest
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
```

**Resultado:** `CHANGELOG.md` com cabeçalho da versão, tag `vX.Y.Z`, imagens `X.Y.Z` e `latest`.

---

## 7. Ordem de Execução e Dependências

1. **Criação de release/hotfix** → roda **`on-new-release-branch`** (bump + âncora).
  * O commit usa `[skip ci]`, não dispara patch build.
2. **Commits na release/hotfix** → **`on-release-patch`**:
  * **Guard** verifica tag âncora; se ausente, sai sem erro.
  * Calcula `N`, bump se necessário, publica imagem `X.Y.N`.
3. **Merge para `master/main`** → **`ready-for-production`**:

  * Gera changelog, cria `vX.Y.Z`, publica `X.Y.Z` + `latest`.

**Concurrency recomendado:**

* `develop-docker`/`build-and-test`:
  `group: ${{ github.workflow }}-${{ github.ref }} • cancel-in-progress: true`
* `on-new-release-branch`:
  `cancel-in-progress: false`
* `on-release-patch`:
  `group: rel-${{ github.ref }} • cancel-in-progress: true`

---

## 8. Proteções de Branch (Obrigatório)

* Branches protegidas: `master/main`, `develop`, `release/*`, `hotfix/*`.
* **Status checks (exatos):**

  * `build-and-test / build` (sucesso)
  * `develop-docker / build` (se aplicável)
  * `on-new-release-branch / anchor` (sucesso)
  * `on-release-patch / build-and-push` (sucesso)
  * `ready-for-production / release-merge` (sucesso)
* **Regras:**

  * **Linear history** (squash-only) em `master/main`/`develop`.
  * **Proibido** rebase/squash/merge em `release/*` e `hotfix/*`; sem force-push.
  * **Require signed commits** e **commit signature verification**.
  * **Dismiss stale reviews** e **CODEOWNERS** para áreas críticas.

---

## 9. GHCR (Notas)

* Preferir autenticação **no próprio `build-push-action`** (`username/password`) com `GITHUB_TOKEN` e `packages: write`.
* Repositórios forkados **não** possuem permissão de escrita em GHCR por padrão.

---

## 10. Fora do Escopo

* Deploy/promoção entre ambientes.
* Política de rollback.
* Observabilidade/telemetria de releases.
* Suporte de versões (LTS, backports, EOL).

---

## 11. Erros Comuns e Mitigações

* **Changelog sem versão no topo:** tag `vX.Y.Z` não aponta para o commit do changelog. **Corrigir ordem** (Seção 6.5).
* **`non-fast-forward` ao push em release:** sincronizar com remoto **antes** do commit (`merge --ff-only`).
* **Falha inicial do patch (`anchor..HEAD` desconhecido):** usar **guard** até âncora existir.
* **Runs canceladas (“higher priority waiting request”):** ajustar `concurrency` por workflow (Seção 7).
* **Login GHCR `denied`:** garantir `permissions: packages: write` e usar credenciais no `build-push-action`.

---

## 12. Métricas

* Lead time de corte de release.
* Reprodutibilidade via `X.Y.Z`.
* Taxa de sucesso dos workflows.
* Changelog consistente por release.

---

## 13. Adoção

1. Habilitar proteções de branch (Seção 8).
2. Subir os workflows:
   `build-and-test.yml`, `develop-docker.yml`, `on-new-release-branch.yml`, `on-release-patch.yml`, `ready-for-production.yml`.
3. Padronizar Conventional Commits (squash title do PR).
4. (Opcional) Adicionar `.changelogrc.json`.
5. Comunicar proibições (rebase/merge/force-push) em `release/*` e `hotfix/*`.
