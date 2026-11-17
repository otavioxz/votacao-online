# Política de segurança

- Nenhuma credencial (AWS, banco, SMTP) é versionada. Elas ficam em GitHub Secrets ou no `.env` da EC2, que está no `.gitignore`.
- Todo push e todo PR passam por Gitleaks, CodeQL e `npm audit`. Se algum falhar, o deploy não acontece.
- O deploy em produção exige aprovação manual de um revisor (GitHub Environment `production`).
- A `main` é protegida: só recebe mudanças via PR com os checks aprovados.

Para reportar uma vulnerabilidade, abra uma issue privada (Security → Report a vulnerability) ou fale com a equipe.
