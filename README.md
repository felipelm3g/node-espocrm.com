# EspoCRM Node (n8n Community Node)

Node comunitário para integrar o n8n ao **EspoCRM (API v1)**, com **CRUD** e seleção **dinâmica** de entidades/campos baseada na instância configurada nas credenciais.

Este projeto é público e pensado para a comunidade: PRs e sugestões são bem-vindas.

## Recursos

- CRUD por entidade: **Ler**, **Criar**, **Editar**, **Deletar**
- Entidades e campos carregados dinamicamente via **Metadata** e **I18n**
- “Ler por Campo(s)” 100% **screen friendly** (sem JSON) com construtor de filtros
- Paginação automática opcional (busca todas as páginas)
- Saída em 2 formatos: **Resposta da API** (`{ total, list }`) ou **1 item por registro**
- Campos de relacionamento tratados de forma segura, expondo atributos derivados (`...Id`, `...Name`, `...Ids`, `...Names`, etc.)

## Requisitos

- n8n com suporte a community nodes
- EspoCRM com **API v1** acessível pela URL base
- API Key de um usuário no EspoCRM (header `X-Api-Key`)

## Instalação

### Via n8n (recomendado)

Instale como community node diretamente pela interface do n8n (Settings → Community Nodes) usando o nome do pacote:

```bash
@felipelm3g/n8n-nodes-espocrm
```

### Via npm (ambiente de desenvolvimento)

```bash
npm install
npm run dev
```

O comando `npm run dev` inicia o n8n em modo de desenvolvimento com o node carregado (via `@n8n/node-cli`).

## Credenciais (EspoCRM API)

Crie uma credencial do tipo **EspoCRM API** com:

- **Base URL**: URL base do seu EspoCRM, com ou sem `/api/v1` (ex.: `https://crm.seudominio.com.br`)
- **API Key**: chave do usuário de API (enviada no header `X-Api-Key`)

Use o botão **Test** na credencial para validar conectividade e autorização.

## Como a lista de entidades e campos é carregada

O node busca dados diretamente da sua instância do EspoCRM:

- Lista de entidades (scopes): `GET /api/v1/Metadata/scopes`
- Labels (i18n): `GET /api/v1/I18n`
  - Entidades: `Global.scopeNames`
  - Campos: `{Entidade}.fields`
- Definição de campos: `GET /api/v1/Metadata?key=entityDefs.{Entidade}.fields`

Por padrão, o node:

- inclui apenas scopes com `entity=true`
- ignora scopes com `disabled=true`

## Operações

### Ler

Operações:

- **Ler Tudo**: `GET /api/v1/{Entidade}`
- **Ler por ID**: `GET /api/v1/{Entidade}/{id}`
- **Ler por Campo(s)**: `GET /api/v1/{Entidade}` com `where` (array) e outros parâmetros

Formato de saída:

- **Resposta da API (1 item)**: retorna `{ total, list }` (mesmo quando vier vazio)
- **Registros (1 item por registro)**: retorna um item por registro

Options (opcional em Ler Tudo e Ler por Campo(s)):

- `maxSize` (0–200): tamanho da página (0 = padrão do EspoCRM)
- `offset`: offset inicial
- `orderBy`, `order`
- `primaryFilter`
- `boolFilterList`
- `textFilter`
- `Buscar Todas as Páginas`: quando ligado, o node pagina até terminar

### Criar

- Faz `POST /api/v1/{Entidade}` com payload JSON
- Os campos são montados no editor com base nas definições/labels da entidade
- Para relacionamentos, use os atributos derivados:
  - `link`: `...Id` e `...Name` (ex.: `assignedUserId`, `assignedUserName`)
  - `linkMultiple`: `...Ids` e `...Names`
  - `linkParent`: `...Id`, `...Type` e `...Name`

### Editar

Faz `PUT /api/v1/{Entidade}/{id}` e oferece 2 modos:

- **Substituir (PUT padrão)**: envia apenas os campos informados (comportamento padrão)
- **Mesclar phone/email (GET + PUT)**: lê o registro, mescla `phoneNumberData` e `emailAddressData` por chave e então envia o PUT

Esse modo evita perder valores existentes quando você quer apenas adicionar/atualizar um telefone/email.

### Deletar

- Faz `DELETE /api/v1/{Entidade}/{id}`
- Retorna `{ "success": true }` quando a API retornar sucesso

## “Ler por Campo(s)”: filtros (sem JSON)

O campo **Filtros** monta o `where` do EspoCRM como um array de condições.

Comportamento:

- Cada item em **Filtros** vira um `where[n]`
- As condições são combinadas como **AND** (o EspoCRM interpreta a lista como filtro acumulativo)
- Para evitar erros e manter a UI simples, o node:
  - valida campos obrigatórios por tipo de filtro
  - bloqueia o mesmo `attribute` repetido em mais de um filtro (use `in`, `notIn`, `between` ou `expression`)

Tipos suportados (principais):

- Comparações: `equals`, `notEquals`, `greaterThan`, `lessThan`, `greaterThanOrEquals`, `lessThanOrEquals`
- Texto: `like`, `notLike`, `startsWith`, `endsWith`, `contains`, `notContains`
- Datas: `after`, `before`, `today`, `past`, `future`, `lastSevenDays`, `lastXDays`, `nextXDays`, `olderThanXDays`, `afterXDays`
- Nulos/booleanos: `isNull`, `isNotNull`, `isTrue`, `isFalse`
- Listas/arrays: `in`, `notIn`, `arrayAnyOf`, `arrayNoneOf`, `arrayAllOf`
- Intervalo: `between` (usa “Valor (De)” e “Valor (Até)”)
- Relacionamentos: `linkedWith`, `notLinkedWith`, `isLinked`, `isNotLinked` (usa “Relacionamento (attribute)”)
- Avançado: `expression` (envia a expressão do EspoCRM diretamente)

### Exemplos

Status em uma lista (equivalente a “status = New OR status = Converted”):

```json
[
  { "type": "in", "attribute": "status", "value": ["New", "Converted"] }
]
```

Negação de lista (equivalente a “NOT (status = Converted OR status = Recycled)”):

```json
[
  { "type": "notIn", "attribute": "status", "value": ["Converted", "Recycled"] }
]
```

Filtro composto com AND:

```json
[
  { "type": "in", "attribute": "status", "value": ["New", "Converted"] },
  { "type": "equals", "attribute": "assignedUserId", "value": "6846ed1e124523a61" }
]
```

Observação: estes exemplos mostram o formato final do `where`. No node, você monta tudo pela UI.

## Como o node monta a querystring do EspoCRM

O EspoCRM espera parâmetros com colchetes, por exemplo:

```text
where[0][type]=equals&where[0][attribute]=assignedUserId&where[0][value]=6846ed1e124523a61
```

O node converte automaticamente objetos/arrays (como `where`) para esse formato.

Quando a API retorna erro (ex.: 400), o node inclui detalhes suficientes para replicar a chamada no Postman/Insomnia.

## Estrutura do projeto

- `nodes/EspoCrm/EspoCrm.node.ts`: implementação do node (UI + execução)
- `credentials/EspoCrmApi.credentials.ts`: credencial (Base URL + API Key + teste)
- `dist/`: build gerado para publicação

## Desenvolvimento

```bash
npm install
npm run lint
npm run typecheck
npm run build
npm run dev
```

## Contribuição

- Issues e PRs são bem-vindos
- Antes de abrir PR, rode:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- Sugestões comuns:
  - novos operadores de filtro do EspoCRM
  - melhorias de UX no construtor de filtros
  - suporte a cenários específicos (relacionamentos, arrays, datas)

## Licença

MIT (veja [LICENSE](./LICENSE)).
