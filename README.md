# Porto Seguro — beta

**Acesse o aplicativo:** [https://porto-seguro-ananunes.web.app](https://porto-seguro-ananunes.web.app)

O Porto Seguro é um aplicativo web em desenvolvimento para acolhimento emocional, respiração guiada e registro privado em diário.

## O que já funciona

- área de apoio que aparece depois do clique;
- respiração guiada em cinco ciclos (4 segundos inspirando e 6 soltando);
- diário com data e hora automáticas;
- título opcional, sentimento, intensidade de 0 a 10 e texto livre;
- sugestão simples de sentimento, sem diagnóstico;
- registros salvos somente no navegador do aparelho;
- edição com preservação das versões anteriores;
- exclusão com aviso;
- impressão ou salvamento em PDF;
- download de backup em JSON;
- restauração de backup no próprio aplicativo;
- funcionamento offline depois do primeiro acesso em um endereço publicado.

## Privacidade desta versão

O conteúdo do diário usa `localStorage`: ele não é enviado ao GitHub nem a um banco de dados. Cada navegador e aparelho possui seus próprios registros. Duas pessoas que usem o mesmo navegador verão os mesmos registros. Limpar os dados do navegador também apaga o diário, por isso existem os botões de baixar e restaurar backup.

Esta versão é beta. O aplicativo não faz diagnóstico e não substitui atendimento profissional ou serviço de emergência.

## Publicar com GitHub Pages

1. Envie todos os arquivos desta pasta para a raiz de um repositório público.
2. No repositório, abra **Settings → Pages**.
3. Em **Build and deployment**, escolha **Deploy from a branch**.
4. Selecione a branch **main**, a pasta **/(root)** e clique em **Save**.
5. Aguarde o endereço do site aparecer na mesma tela.

Nenhum dado escrito no diário é incluído no repositório: somente o código do aplicativo é publicado.
