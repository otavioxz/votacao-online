# Sistema de Votação Online

Eleições de representantes estudantis na AWS (AWS Academy Learner Lab), com WAF, VPC com sub-redes privadas, IAM com privilégio mínimo e CI/CD no GitHub Actions com aprovação manual.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `web/` | App do eleitor: pede código por e-mail, valida e registra o voto |
| `admin/` | App da comissão: cria votação, importa CSV de eleitores, dashboard |
| `db/schema.sql` | Tabelas do RDS PostgreSQL |
| `deploy/` | Serviços systemd e script de preparação das EC2 |
| `.github/workflows/ci-cd.yml` | Pipeline: build/testes → segurança → aprovação → deploy |
| `.github/dependabot.yml` | Atualização automática de dependências |

## Rodando localmente

```bash
cd web   && npm install && npm test && npm start   # http://localhost:3000
cd admin && npm install && npm test && npm start   # http://localhost:3001
```

## Pipeline CI/CD

1. **Build e testes**: `npm ci`, build e `npm test` nos dois apps.
2. **Verificação de segurança**: Gitleaks (segredos), `npm audit` (dependências) e CodeQL (análise do código). Se falhar, não publica.
3. **Aprovação manual**: o job de deploy usa o environment `production`, que exige um revisor.
4. **Deploy**: com as credenciais do Learner Lab, o job envia um comando via **SSM Run Command** para as duas EC2 (sem SSH e sem IP público), que fazem checkout do commit aprovado e reiniciam o serviço.

## Configuração do GitHub (uma vez)

1. **Settings → Branches**: proteger a `main` (exigir PR e os checks `build-test` e `security`).
2. **Settings → Environments → `production`**: adicionar *Required reviewers*.
3. **Settings → Secrets and variables → Actions**
   - Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (Learner Lab → AWS Details; **renovar a cada sessão**)
   - Variables: `WEB_INSTANCE_ID`, `ADMIN_INSTANCE_ID`
4. **Settings → Code security**: ativar Dependabot alerts e security updates.

> No plano gratuito, CodeQL e revisores obrigatórios em Environments exigem repositório **público**.

## Preparação das EC2 (uma vez)

As instâncias usam o `LabInstanceProfile` (permite SSM). Conecte via Session Manager e rode:

```bash
sudo bash bootstrap-ec2.sh web     # na EC2 do app web
sudo bash bootstrap-ec2.sh admin   # na EC2 do app admin
```

Depois, edite `/opt/votacao/.env` com os dados reais do RDS e do SMTP.
