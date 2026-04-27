# EspoCRM Node (n8n)

## Instalação

```bash
npm install @felipelm3g/n8n-nodes-espocrm
```

Este pacote adiciona um node “EspoCRM” no n8n com operações agrupadas por:

- Ler (Ler Tudo, Ler por ID, Ler por Campo(s))
- Criar
- Editar
- Deletar

As entidades (incluindo custom) são carregadas dinamicamente da instância do EspoCRM configurada nas credenciais. O nome exibido no dropdown é o nome “humano” (renomeado no seu EspoCRM), não o nome técnico. Por exemplo: `Opportunity` aparece como `Proposta`.

## Como funciona a listagem de entidades

- A lista de entidades é obtida via `GET /api/v1/Metadata/scopes`.
- Os nomes exibidos são obtidos via `GET /api/v1/I18n`, usando:
  - `Global.scopeNames` (singular) para o nome da entidade.
- Por padrão, o node filtra entidades com `entity=true` (e ignora `disabled=true`).

## Credenciais

Crie uma credencial do tipo **EspoCRM API** com:

- Base URL: a URL base do seu EspoCRM (ex.: `https://crm.dutysaude.com.br`). Pode ser informada com ou sem `/api/v1`.
- API Key: a chave do usuário de API (header `X-Api-Key`)

Ao criar a credencial, use o botão **Test** para validar:

- Conexão com a Base URL
- Validade da API Key

## Ícone

O node usa o arquivo [logo.png](file:///Applications/XAMPP/xamppfiles/htdocs/node-espocrm.com/logo.png) como ícone no n8n.

## Operações

### Ler

- **Formato de Saída**
  - **Resposta da API (1 item)**: retorna `{ total, list }` (mesmo quando vier vazio)
  - **Registros (1 item por registro)**: retorna um item por registro
- **Options (opcional)**
  - `maxSize`, `offset`, `orderBy`, `order`, `primaryFilter`, `boolFilterList`, `textFilter`
  - `Buscar Todas as Páginas`: quando desligado, faz apenas 1 request (espelho da API). Padrão: ligado no **Ler Tudo** e desligado no **Ler por Campo(s)** (a menos que você adicione esta opção).

- **Ler Tudo**
  - Faz `GET /api/v1/{Entidade}` (com filtros/paginação se configurados em Options)
- **Ler por ID**
  - Faz `GET /api/v1/{Entidade}/{id}`
- **Ler por Campo(s)**
  - Faz `GET /api/v1/{Entidade}` com `where` (array) e outros parâmetros (Options)
  - Você pode montar o filtro via **Construtor** (UI) ou via **JSON (avançado)**
  - O node converte automaticamente o `where` para o formato de querystring usado pelo EspoCRM (ex.: `where[0][type]=...&where[0][attribute]=...`)
  - Exemplo de `where`:
    ```json
    [
      { "type": "isTrue", "attribute": "cAPIBrasil" },
      { "type": "isTrue", "attribute": "cHyperFlow" },
      { "type": "equals", "attribute": "assignedUserId", "value": "6846ed1e124523a61" }
    ]
    ```

Quando a API retornar erro (ex.: 400), o node inclui no erro a URL montada para facilitar replicar no Postman.

### Criar

- Faz `POST /api/v1/{Entidade}` com payload JSON
- Os campos são montados no editor por:
  - Lista de campos via `GET /api/v1/Metadata?key=entityDefs.{Entidade}.fields`
  - Labels dos campos via `GET /api/v1/I18n` em `{Entidade}.fields`
- Para campos de relacionamento do tipo `linkParent` (ex.: `parent` em `Note`), o node também disponibiliza `...Id` e `...Type` para preencher corretamente.
- Para campos de relacionamento:
  - `link` (ex.: `assignedUser`): o dropdown também inclui `...Id` e `...Name` (ex.: `assignedUserId`, `assignedUserName`).
  - `linkMultiple` (ex.: `teams`): o dropdown também inclui `...Ids` e `...Names`.
  - `linkParent` (ex.: `parent` em `Note`): o dropdown também inclui `...Id`, `...Type` e `...Name`.

### Editar

- Faz `PUT /api/v1/{Entidade}/{id}` com payload JSON
- Seleção de campos igual à operação Criar

### Deletar

- Faz `DELETE /api/v1/{Entidade}/{id}`
- Retorna `{ "success": true }` quando a API retornar sucesso

## Desenvolvimento local

```bash
npm install
npm run build
npm run lint
npm run typecheck
npm run dev
```

O comando `npm run dev` inicia o n8n em modo de desenvolvimento com o node carregado (via @n8n/node-cli).
