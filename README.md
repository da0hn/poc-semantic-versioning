# RFC — Versionamento, Branching e Releases (Java + Node.js)

- **Status:** Draft
- **Data:** 2025-08-14
- **Autor:** Gabriel
- **Revisores:** ...

---

## 1. Contexto

Padronizar versionamento, estratégia de branches, geração de imagens Docker e changelog para projetos **Java + Maven** e **Node.js**. Objetivo: previsibilidade, reprodutibilidade e automação de releases com **GitHub Actions** e **GHCR**.

---

## 2. Objetivos

* Definir branches e convenções (Git Flow).
* Automatizar o **bump** de versão (pom.xml / package.json) ao criar `release/*` e `hotfix/*`.
* **Tornar obrigatório** o bump e a validação de versão em `release/*` e `hotfix/*` (Java e Node) com falha de pipeline em caso de mismatch.
* Gerar imagens Docker com tags determinísticas:

  * `develop`: `develop-${run_number}`
  * `release/*` e `hotfix/*`: `X.Y.N` (N = nº de commits desde a criação da branch)
  * `main`: `latest` **(e opcionalmente também ****************************`X.Y.Z`**************************** para reprodutibilidade)**
* Gerar `CHANGELOG.md` a partir de Conventional Commits.

### Fora do escopo

* Pipeline de deploy e promoção entre ambientes.
* Política de rollback (estratégia e automação).
* Observabilidade/telemetria específicas de releases.
* Estratégia de suporte de versões (LTS, backports, EOL).

---

## 3. Estratégia de Branches (Git Flow)

```
main            → produção (tags de release)
develop         → integração contínua
release/X.Y.Z   → estabilização de release
hotfix/X.Y.Z    → correções críticas a partir de main
feature/*       → novas funcionalidades
bugfix/*        → correções não críticas
```

**Políticas:**

* `release/*` e `hotfix/*`: **sem rebase**, **sem force-push**, **sem merge de develop**; apenas commits diretos e cherry-picks.
* `main` e `develop`: protegidas; merge via PR com checks obrigatórios.

---

## 4. Versionamento

* **SemVer**: `MAJOR.MINOR.PATCH`.
* A **fonte de verdade** da versão é a branch `release/X.Y.Z` ou `hotfix/X.Y.Z` na criação:

  * Java: `pom.xml` atualizado para `X.Y.Z`.
  * Node: `package.json` atualizado para `X.Y.Z`.
* Criar **tag âncora** no momento da criação da branch:

  * `release-base/X.Y.Z` (para release)
  * `hotfix-base/X.Y.Z` (para hotfix)

**Por que âncora?** Garante que o contador `N` ignore commits externos (ex.: novos commits em `develop`/`main`).

**Obrigatório:** o bump automático na criação da branch e a validação de `pom.xml`/`package.json` em *todo* build de `release/*` e `hotfix/*`. O pipeline **falha** se a versão de arquivo divergir da versão da branch.

---

## 5. Tagging de Imagens Docker

**Placeholders globais (obrigatórios nos workflows):**

* `REGISTRY`: registro de container (ex.: `ghcr.io`)
* `IMAGE_NAME`: `<org>/<repo>` base
* Para múltiplas stacks no mesmo repositório: `IMAGE_NAME-java` e `IMAGE_NAME-node`

**Regras de tag:**

* `develop`: `${REGISTRY}/${IMAGE_NAME}:develop-${{ github.run_number }}`
* `release/*`: `${REGISTRY}/${IMAGE_NAME}:X.Y.N` (N = commits entre tag âncora e HEAD da release)
* `hotfix/*`: `${REGISTRY}/${IMAGE_NAME}:X.Y.N` (âncora de hotfix)
* `main`: **obrigatório** publicar **duas** tags:

  * `${REGISTRY}/${IMAGE_NAME}:latest`
  * `${REGISTRY}/${IMAGE_NAME}:X.Y.Z` (sempre que existir a tag `vX.Y.Z` no Git)

**Rótulos OCI (metadados):**

```
org.opencontainers.image.source=${{ github.repository }}
org.opencontainers.image.revision=${{ github.sha }}
org.opencontainers.image.version=${{ tag }}
```

---

## 6. Changelog (Conventional Commits)

* Padrão: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `test:` …
* Geração automática entre a **tag âncora** e o HEAD das branches `release/*` e `hotfix/*` utilizando **TriPSs/conventional-changelog-action\@v6**.

---

## 7. Workflows — Java + Maven

### 7.0 Ordem de execução e dependências

* **Na criação de release/hotfix**:

  1. `java-anchor` ou `node-anchor`: faz bump de versão e cria tag âncora.
  2. O push resultante dispara `changelog` e `java-build-and-push`/`node-build-and-push`.
* **Em commits subsequentes**: `changelog` e build executam em paralelo.
* **Boas práticas**:

  * Adicionar `concurrency` por branch para evitar execuções concorrentes:

    ```yaml
    concurrency:
      group: ${{ github.workflow }}-${{ github.ref }}
      cancel-in-progress: true
    ```
  * Usar `fetch-depth: 0` e `git fetch --tags` nos jobs que dependem de contagem de commits ou tags.
  * Configurar `paths-ignore: CHANGELOG.md` no changelog para evitar loops.

### 7.1. Criar release/hotfix (bump + âncora)

`.github/workflows/java-anchor.yml`

```yaml
name: java-anchor
on:
  create:
    branches: ['release/*','hotfix/*']
permissions:
  contents: write
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  bump-and-anchor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
      - name: Set Maven version from branch and create base tag
        shell: bash
        run: |
          BR="${GITHUB_REF_NAME}"            # release/1.3.0 ou hotfix/1.3.1
          VER="${BR#*/}"                     # 1.3.0
          KIND="${BR%%/*}"                   # release|hotfix
          mvn -q versions:set -DnewVersion="$VER" -DprocessAllModules=true -DgenerateBackupPoms=false
          mvn -q versions:commit
          git add -A
          git commit -m "chore: set version $VER from $BR" || echo "no changes"
          BASE_TAG="$KIND-base/$VER"
          git tag -a "$BASE_TAG" -m "base of $BR at creation"
          git push origin HEAD:"$BR"
          git push origin "$BASE_TAG"

```

### 7.2. Build & Push Docker

`.github/workflows/java-docker.yml`

```yaml
name: java-build-and-push
on:
  push:
    branches: [ develop, main, 'release/*', 'hotfix/*' ]
permissions:
  contents: read
  packages: write
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository_owner }}/minha-imagem-java
jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
      - name: Validate version matches branch
        if: startsWith(github.ref_name, 'release/') || startsWith(github.ref_name, 'hotfix/')
        run: |
          BR="${GITHUB_REF_NAME}"
          VER="${BR#*/}"
          POM_VER=$(mvn -q -DforceStdout -Dexpression=project.version -DnonRecursive=true help:evaluate)
          [ "$POM_VER" = "$VER" ] || { echo "pom.xml=$POM_VER != $VER"; exit 1; }
      - name: Build JAR
        run: mvn -B -DskipTests package
      - name: Compute docker tag
        id: vars
        shell: bash
        run: |
          BR="${GITHUB_REF_NAME}"
          if [[ "$BR" == "develop" ]]; then
            TAG="develop-${GITHUB_RUN_NUMBER}"
          elif [[ "$BR" == "main" ]]; then
            TAG="latest"
          elif [[ "$BR" == release/* || "$BR" == hotfix/* ]]; then
            VERSION="${BR#*/}"                        # 1.3.0
            MAJOR="${VERSION%%.*}"
            MINOR="$(echo "$VERSION" | cut -d. -f2)"
            git fetch --tags --quiet
            BASE_TAG="${BR%%/*}-base/${VERSION}"
            COUNT=$(git rev-list --count "$BASE_TAG..origin/$BR")
            TAG="$MAJOR.$MINOR.$COUNT"
          else
            TAG="${BR//\//-}-${GITHUB_SHA::7}"
          fi
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"
      - name: Login GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build & Push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.vars.outputs.tag }}
          labels: |
            org.opencontainers.image.source=${{ github.repository }}
            org.opencontainers.image.revision=${{ github.sha }}
            org.opencontainers.image.version=${{ steps.vars.outputs.tag }}

```

### 7.3. Corte de release em `main` — workflow único por tag

**Requisito normativo:** Ao criar a tag `vX.Y.Z` em `main`, **deve** publicar **duas** tags para cada stack (**Java** e **Node**) a partir do **mesmo digest**: `X.Y.Z` **e** `latest`. A publicação **deve** ocorrer em **um único workflow** acionado por tag com **matriz** `stack: [java, node]`.

`.github/workflows/release-cut.yml`

```yaml
name: release-cut
on:
  push:
    tags: ['v*']
permissions:
  contents: read
  packages: write
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
env:
  REGISTRY: ghcr.io
jobs:
  release:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        stack: [java, node]
        include:
          - stack: java
            image_name: ${{ github.repository_owner }}/minha-imagem-java
          - stack: node
            image_name: ${{ github.repository_owner }}/minha-imagem-node
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - name: Derive version from tag
        id: v
        shell: bash
        run: |
          VER="${GITHUB_REF_NAME#v}"
          echo "ver=$VER" >> "$GITHUB_OUTPUT"

      - name: Setup toolchain (Java)
        if: matrix.stack == 'java'
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'

      - name: Setup toolchain (Node)
        if: matrix.stack == 'node'
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Validate version matches files
        shell: bash
        run: |
          VER="${{ steps.v.outputs.ver }}"
          if [[ "${{ matrix.stack }}" == "java" ]]; then
            POM_VER=$(mvn -q -DforceStdout -Dexpression=project.version -DnonRecursive=true help:evaluate)
            [[ "$POM_VER" == "$VER" ]] || { echo "pom.xml=$POM_VER != $VER"; exit 1; }
          else
            PKG_VER=$(jq -r '.version' package.json)
            [[ "$PKG_VER" == "$VER" ]] || { echo "package.json=$PKG_VER != $VER"; exit 1; }
          fi

      - name: (Optional) Build artifact
        run: |
          if [[ "${{ matrix.stack }}" == "java" ]]; then
            mvn -B -DskipTests package || true
          else
            npm ci && npm run build || true
          fi

      - name: Login GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build & Push (X.Y.Z and latest)
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ matrix.image_name }}:${{ steps.v.outputs.ver }}
            ${{ env.REGISTRY }}/${{ matrix.image_name }}:latest
          labels: |
            org.opencontainers.image.source=${{ github.repository }}
            org.opencontainers.image.revision=${{ github.sha }}
            org.opencontainers.image.version=${{ steps.v.outputs.ver }}
```

**Critérios de aceitação:**

* Publicar `ghcr.io/<org>/<img>-java:X.Y.Z` e `:latest` e o mesmo para `-node`.
* Cada par (`X.Y.Z`, `latest`) aponta para o **mesmo digest**.
* Logs devem exibir a versão extraída da tag e a validação de versão do arquivo (`pom.xml`/`package.json`).

## 8. Workflows — Node.js

### 8.1. Criar release/hotfix (bump + âncora)

`.github/workflows/node-anchor.yml`

```yaml
name: node-anchor
on:
  create:
    branches: ['release/*','hotfix/*']
permissions:
  contents: write
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  bump-and-anchor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - name: Set package.json version and create base tag
        shell: bash
        run: |
          BR="${GITHUB_REF_NAME}"
          VER="${BR#*/}"
          KIND="${BR%%/*}"
          npm version --no-git-tag-version "$VER"
          git add package.json package-lock.json || true
          git commit -m "chore: set version $VER from $BR" || echo "no changes"
          BASE_TAG="$KIND-base/$VER"
          git tag -a "$BASE_TAG" -m "base of $BR at creation"
          git push origin HEAD:"$BR"
          git push origin "$BASE_TAG"

```

### 8.2. Build & Push Docker

`.github/workflows/node-docker.yml`

```yaml
name: node-build-and-push
on:
  push:
    branches: [ develop, main, 'release/*', 'hotfix/*' ]
permissions:
  contents: read
  packages: write
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository_owner }}/minha-imagem-node
jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - name: Validate version matches branch
        if: startsWith(github.ref_name, 'release/') || startsWith(github.ref_name, 'hotfix/')
        run: |
          BR="${GITHUB_REF_NAME}"
          VER="${BR#*/}"
          PKG_VER=$(jq -r '.version' package.json)
          [ "$PKG_VER" = "$VER" ] || { echo "package.json=$PKG_VER != $VER"; exit 1; }
      - name: Install & Build
        run: |
          npm ci
          npm run build || echo "no build step"
      - name: Compute docker tag
        id: vars
        shell: bash
        run: |
          BR="${GITHUB_REF_NAME}"
          if [[ "$BR" == "develop" ]]; then
            TAG="develop-${GITHUB_RUN_NUMBER}"
          elif [[ "$BR" == "main" ]]; then
            TAG="latest"
          elif [[ "$BR" == release/* || "$BR" == hotfix/* ]]; then
            VERSION="$(jq -r '.version' package.json)"
            MAJOR="${VERSION%%.*}"
            MINOR="$(echo "$VERSION" | cut -d. -f2)"
            git fetch --tags --quiet
            BASE_TAG="${BR%%/*}-base/${VERSION}"
            COUNT=$(git rev-list --count "$BASE_TAG..origin/$BR")
            TAG="$MAJOR.$MINOR.$COUNT"
          else
            TAG="${BR//\//-}-${GITHUB_SHA::7}"
          fi
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"
      - name: Login GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build & Push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.vars.outputs.tag }}
          labels: |
            org.opencontainers.image.source=${{ github.repository }}
            org.opencontainers.image.revision=${{ github.sha }}
            org.opencontainers.image.version=${{ steps.vars.outputs.tag }}

```

---

## 9. Changelog automático

Gerado **sempre** que uma branch `release/*` ou `hotfix/*` for **criada** ou receber **commits**, **da tag âncora até o HEAD da branch** usando **TriPSs/conventional-changelog-action\@v6**.

### Workflow único (Java/Node)

`.github/workflows/changelog.yml`

```yaml
name: changelog
on:
  create:
    branches: ['release/*','hotfix/*']
  push:
    branches: ['release/*','hotfix/*']
    paths-ignore:
      - 'CHANGELOG.md'
permissions:
  contents: write
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Resolve tag-prefix from anchor
        id: cfg
        shell: bash
        run: |
          BR="${GITHUB_REF_NAME}"                 # release/1.3.0 ou hotfix/1.3.1
          KIND="${BR%%/*}"                        # release|hotfix
          echo "tag_prefix=${KIND}-base/" >> "$GITHUB_OUTPUT"
      - name: Generate CHANGELOG from anchor..HEAD
        uses: TriPSs/conventional-changelog-action@v6
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          preset: angular
          tag-prefix: ${{ steps.cfg.outputs.tag_prefix }}
          output-file: CHANGELOG.md
          skip-bump: 'true'
          skip-tag: 'true'
          skip-version-file: 'true'
          release-count: '0'
      - name: Commit CHANGELOG
        shell: bash
        run: |
          git add CHANGELOG.md
          if git diff --cached --quiet; then
            echo "No changes in CHANGELOG.md"; exit 0; fi
          git commit -m "docs(changelog): update for ${GITHUB_REF_NAME} [skip ci]"
          git push

```

> Observação: ao usar `tag-prefix: release-base/` (ou `hotfix-base/`), a ação calcula o changelog **desde a tag âncora** até o commit atual da branch, sem criar novas tags.

---

## 10. Regras de Qualidade/Segurança

### 10.1 Branch Protection — branches protegidas

* `main`, `develop`, `release/*`, `hotfix/*`.

### 10.3 Observações

* **Método de merge por branch**:

  * `main` / `develop`: \*\*apenas \*\****squash merge*** (garante histórico linear).
  * `release/*` e `hotfix/*`: **proibido** rebase/squash/merge; **somente commits diretos e cherry‑pick**.
* `release/*` e `hotfix/*`: **proibido** force‑push.
* **Assinaturas**: habilitar **Require signed commits** e **Require commit signature verification** nas branches protegidas.
* Checks complementares: build, testes, lint, scan de dependências.
* GHCR: pacote como **public** (se imagens públicas) após primeiro push.

---

## 11. Casos limite e comportamento

* Commits em `develop`/`main` **não** afetam `N` (contagem a partir da tag âncora).
* Merge `develop → release/*` e *rebase* em `release/*`/`hotfix/*`: **proibido** (distorce histórico e inflaria `N`).
* Force-push em `release/*` e `hotfix/*`: **proibido** (reseta `N`).
* **Em caso de violação:** fechar o PR, recriar a branch a partir da tag âncora (`release-base/X.Y.Z` ou `hotfix-base/X.Y.Z`) e reiniciar a contagem `N`.

---

## 12. Monorepo (nota rápida)

* Java multi-módulo / Node workspaces: um job por serviço com contexto na pasta do serviço; cada serviço publica sua própria imagem e aplica as mesmas regras de tag.

---

## 13. Plano de Adoção

1. Habilitar branch protection conforme seção 10.
2. Adicionar workflows (7 e 8) aos repositórios.
3. Padronizar Conventional Commits.
4. Tornar GHCR público (se necessário).
5. Comunicar políticas de release/hotfix (sem rebase/force-push).

---

## 14. Métricas de sucesso

* Tempo de corte de release previsível.
* Reprodutibilidade: deploys a partir de `X.Y.Z` estabilizados.
* Changelogs gerados automaticamente sem intervenção manual.

---

## 15. Abertos

* Confirmar se `main` deve **sempre** publicar também `X.Y.Z` além de `latest`.
* Definir política de expiração/retention de imagens antigas no GHCR.
