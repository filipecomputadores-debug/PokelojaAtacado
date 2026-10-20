# POKELOJA ATACADO — VERSÃO FINAL / BASE DE PRODUÇÃO

Stack:
- Node.js + Express
- SQLite (better-sqlite3)
- Sessão segura
- bcrypt para senhas
- Front-end responsivo

## Rodar no computador
1. Instale Node.js 20+.
2. Abra um terminal nesta pasta.
3. Copie `.env.example` para `.env`.
4. Defina SESSION_SECRET e ADMIN_PASSWORD.
5. Execute:
   npm install
   npm start
6. Acesse http://localhost:3000

## Melhor Envio
A integração foi separada no endpoint `/api/shipping/calculate` para que o token nunca fique no navegador.
O valor enviado ao cliente é o valor FINAL de cobrança. O acréscimo interno de 10% NÃO é exibido para o cliente.
No banco ficam separados:
- freight_internal = custo/base
- freight_customer = valor cobrado do cliente
O painel administrativo pode visualizar ambos.

Para produção, configure OAuth2 do Melhor Envio e substitua o cálculo demonstrativo pelo retorno da API. A API exige token no servidor e renovação de tokens.

## Antes de abrir para clientes reais
- configurar domínio/HTTPS;
- configurar variáveis de ambiente;
- conectar Melhor Envio em produção;
- definir CEP de origem;
- cadastrar produtos, pesos e dimensões reais;
- configurar backup do banco;
- configurar SMTP/e-mail para avisos;
- revisar LGPD, política de privacidade e termos;
- configurar pagamento, se desejado.

## Login administrativo
Definido pelas variáveis ADMIN_EMAIL e ADMIN_PASSWORD no `.env`.
