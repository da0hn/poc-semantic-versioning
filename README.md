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
* `IMAGE` (ex.: `${{ github.repository_owner }}/semantic-versioning-poc`)

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

## 6. Workflows (arquivos e responsabilidades)

> **Arquivos vigentes**: `build-and-test.yml`, `develop-docker.yml`, `on-new-release-branch.yml`, `on-release-patch.yml`, `ready-for-production.yml`.

### 6.1 `build-and-test.yml`

* **Disparo:** PRs para `develop`/`master` e/ou `push` (conforme repo).
* **Função:** build, testes, lint/scan.
* **Status check obrigatório** para merges.

### 6.2 `develop-docker.yml`

* **Disparo:** `push` em `develop`.
* **Saída:** imagem `${REGISTRY}/${IMAGE}:develop-${{ github.run_number }}`.
* **Permissões:** `packages: write`.

### 6.3 `on-new-release-branch.yml`

* **Disparo:** `create` em `release/*` e `hotfix/*`.
* **Passos:**

  * Bump `pom.xml` para `X.Y.0` (ou `X.Y.Z` em hotfix).
  * Commit `[skip ci]`.
  * Criar tag **âncora** `release-base/X.Y.0` (ou `hotfix-base/X.Y.Z`).
  * *Opcional:* gravar `.version.json`.
* **Concurrency:** **não** cancelar execuções em progresso (evita corrida com `push`).

### 6.4 `on-release-patch.yml`

* **Disparo:** `push` em `release/*` e `hotfix/*`.
* **Guard:** se âncora não existir ainda, **sair** sem erro (evita falha inicial).
* **Passos:**

  * Sincronizar branch (`git fetch --tags` e `merge --ff-only`).
  * Calcular `X.Y.N` a partir da **âncora** (ou `anchor_sha`).
  * Se `pom.xml` ≠ `X.Y.N`, bump + commit `[skip ci]`.
  * Build JAR.
  * Publicar Docker `${REGISTRY}/${IMAGE}:X.Y.N`.

### 6.5 `ready-for-production.yml`

* **Disparo:** `push` em `master/main` (merge da release).
* **Passos (ordem):**

  1. `git fetch --tags`.
  2. **Gerar changelog** (`-n .changelogrc.json` se existir; `-r 0`).
  3. Commit `docs(changelog): X.Y.Z [skip ci]`.
  4. Criar **tag** `vX.Y.Z` (apontando para o commit do changelog).
  5. Build JAR.
  6. Publicar Docker com **duas** tags: `X.Y.Z` **e** `latest`.

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

* Branches protegidas: `master`, `develop`, `release/*`, `hotfix/*`.
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
