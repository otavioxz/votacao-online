# Sistema de Votação Online

Eleições de representantes estudantis na AWS (conta própria ou AWS Academy Learner Lab), com WAF, VPC com sub-redes privadas, IAM com privilégio mínimo, CI/CD no GitHub Actions com SAST e aprovação manual, e **toda a infraestrutura criada com um único `terraform apply`** (o próprio Terraform é o plano de DR).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `web/` | App do eleitor: escolhe a votação, recebe código por e-mail, valida, vota uma vez, vê o resultado |
| `admin/` | App da comissão (`/admin`): login por código, cria votação, candidatos, importa CSV, dashboard com gráficos, auditoria |
| `db/schema.sql` | Tabelas do RDS PostgreSQL (aplicado automaticamente por `admin/src/migrate.js`) |
| `deploy/` | `bootstrap-ec2.sh` (1º boot), `atualizar.sh` (cada deploy) e serviços systemd |
| `terraform/` | VPC, WAF, ALB, EC2, RDS, SSM, CloudWatch, SNS e CloudTrail |
| `.github/workflows/ci-cd.yml` | Pipeline: build/testes → segurança (Gitleaks, npm audit, CodeQL, Terraform) → aprovação → deploy |

## Requisitos do trabalho → onde estão

| Requisito | Implementação |
|---|---|
| CI/CD com SAST | `ci-cd.yml`: testes dos 2 apps, **CodeQL** (qualquer alerta bloqueia), **npm audit** (high/critical bloqueia), **Gitleaks**, **terraform validate + Checkov**, **aprovação manual** no environment `production`, deploy via **SSM Run Command** (sem SSH) |
| Terraform (DR) | `terraform/`: um `apply` cria tudo; as EC2 clonam o repo e se instalam sozinhas. Trocar `region` sobe tudo em outra região |
| Segmentação de rede | VPC 10.0.0.0/16, 3 camadas em 2 AZs: públicas (ALB, NAT), aplicação (EC2 sem IP público), banco (**sem rota para fora**). Security Groups em cadeia ALB → EC2 (3000/3001) → RDS (5432) |
| Balanceador com WAF | ALB com HTTPS (HTTP redireciona) + AWS WAF: SQLi, XSS, entradas maliciosas, IPs de má reputação, **rate limit** nas rotas de código, **`/admin` só pelos IPs da instituição**, logs no CloudWatch |
| Aplicação funcional | Fluxo completo de votação com banco, e-mail SMTP, dashboard e auditoria |

Segurança na aplicação: código guardado só como hash scrypt + salt, código único por eleitor, 5 tentativas, `SELECT … FOR UPDATE` contra voto duplo, votos sem e-mail/horário (UUID), **dois usuários de banco** (`votacao_web`, `votacao_admin`) sem permissão para alterar votos ou apagar auditoria, CSRF, CSP/Helmet, escape automático de HTML, TLS validado até o RDS, segredos no SSM Parameter Store, IMDSv2, discos e banco criptografados.

## Subir na AWS

1. **Pré-requisitos**: Terraform ≥ 1.5 e AWS CLI. Descubra seu IP com `curl https://checkip.amazonaws.com`.
   - **Conta AWS própria** (padrão, região `us-east-2`): IAM → Usuários → criar `github-deploy` → chave de acesso (CLI) → `aws configure`. O Terraform cria a role das EC2 (`terraform/iam.tf`).
   - **AWS Academy**: copie as credenciais de **AWS Details → AWS CLI** e use `region = "us-east-1"` e `create_instance_role = false` (usa o `LabInstanceProfile`).
2. **Variáveis**:
   ```bash
   cd terraform
   cp terraform.tfvars.example terraform.tfvars   # preencha IPs e e-mails
   ```
3. **Criar tudo**:
   ```bash
   terraform init
   terraform apply
   ```
   Leva ~15 min (RDS). Depois, ~5 min para as EC2 se instalarem. Saídas: `url_eleitor`, `url_admin`.
   - Confirme o e-mail do SNS para receber os alarmes.
   - **E-mail (Amazon SES)**: clique no link "Email Address Verification Request" que chega no remetente e em cada e-mail da comissão. Conta nova fica no *sandbox* do SES, que só entrega para endereços verificados: para testar como eleitor, coloque o e-mail em `ses_verified_emails`; para liberar qualquer destinatário (eleitores cadastrados na hora), peça *production access* em SES → Account dashboard. E-mails devolvidos (bounce) e reclamações chegam como alerta no SNS e o endereço vai para a lista de supressão.
   - No AWS Academy (sem SES): `email_via_ses = false` e preencha `smtp_*` com um SMTP externo (ex.: Gmail com *senha de app*).
   - O HTTPS usa certificado autoassinado (o Academy não permite domínio próprio): aceite o aviso do navegador.
   - Se der `AccessDenied` no CloudTrail: `enable_cloudtrail = false` e rode de novo.
   - Para testar uma branch antes do merge: `git_ref = "nome-da-branch"`.
4. **Usar**: em `url_admin` (do IP liberado), entre com um e-mail da comissão, crie a votação, cadastre candidatos e importe o CSV. Quando abrir, o eleitor usa `url_eleitor`.

## Configuração do GitHub (uma vez)

1. **Settings → Branches**: proteger a `main` (exigir PR e os checks `build-test`, `security` e `iac`).
2. **Settings → Environments → `production`**: adicionar *Required reviewers*.
3. **Settings → Secrets and variables → Actions**
   - Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (+ `AWS_SESSION_TOKEN` só no AWS Academy, renovando a cada sessão)
   - Variables (opcionais): `AWS_REGION` (padrão `us-east-2`), `PROJECT` (padrão `votacao`). Os IDs das EC2 não são mais necessários: o deploy encontra as instâncias pela tag.
4. **Settings → Code security**: ativar Dependabot alerts e security updates.

> No plano gratuito, CodeQL e revisores obrigatórios em Environments exigem repositório **público**.

O deploy faz, em cada EC2 via SSM: `git checkout` do commit aprovado → `npm ci` → migrações (admin) → restart → health check. Admin primeiro, depois web.

## Plano de DR

- **Perda de uma EC2**: `terraform apply -replace='aws_instance.app["web"]'`. A nova instância lê os segredos do SSM, clona o repo e sobe sozinha.
- **Perda da região**: `terraform apply -var region=us-west-2` recria rede, WAF, ALB, banco e aplicação. Os dados voltam pelo backup automático do RDS (ou banco vazio, recriado pela migração).
- **Rollback**: reverter o commit na `main`; o pipeline publica a versão anterior após aprovação.

## Demonstração de segurança

| Teste | Ação | Esperado |
|---|---|---|
| SQL injection | `curl -k "https://ALB/?id=1'%20OR%20'1'='1"` | 403 do WAF |
| XSS | `curl -k "https://ALB/?q=<script>alert(1)</script>"` | 403 do WAF |
| Admin fora da instituição | abrir `/admin` pelo 4G | 403 do WAF |
| Força bruta | errar o código 5 vezes | bloqueio + alarme por e-mail |
| Voto duplicado | votar de novo com o mesmo e-mail | negado + evento `VOTO_DUPLICADO` |
| Pipeline | subir dependência vulnerável ou segredo | pipeline falha, sem deploy |

Logs: CloudWatch `/votacao/app` e `aws-waf-logs-votacao`. Ações na conta: CloudTrail. Acesso às EC2: Session Manager.

## Rodando localmente

```bash
cd web   && npm install && npm test    # testes não precisam de banco
cd admin && npm install && npm test
```
Para rodar com banco: PostgreSQL local, `cp .env.example .env`, aplique o schema com `npm run migrate` em `admin/` (variáveis `DB_MASTER_*`, `DB_WEB_PASSWORD`, `DB_ADMIN_PASSWORD`) e inicie com `COOKIE_SECURE=false npm start`. Sem SMTP, o código aparece no terminal.

## Limpeza

`terraform destroy` remove tudo. NAT Gateway e RDS consomem créditos do Learner Lab.
