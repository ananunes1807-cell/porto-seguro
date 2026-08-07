# Porto Seguro — beta

Aplicativo web de apoio emocional, respiração guiada e diário local. A frase central é: “Podemos te apoiar, mas, primeiramente, não se esqueça de você.”

**Acesse o aplicativo:** [https://porto-seguro-ananunes.web.app](https://porto-seguro-ananunes.web.app)

## Recursos disponíveis

- fluxo de apoio progressivo, mensagem de regulação e opções de ajuda humana;
- fluxo “Não consigo falar agora” com mensagens prontas, edição do texto e abertura manual do WhatsApp;
- plano pessoal de segurança com sinais, gatilhos, estratégias, lugares seguros, profissionais e contatos, salvo localmente, imprimível e incluído no backup;
- registro pós-crise com intensidade antes e depois, possível gatilho, estratégia, resultado e observações, integrado ao diário, aos relatórios e ao backup;
- caixa de acolhimento com textos, foto e áudio locais, com limites de tamanho e exclusão confirmada;
- gravação de áudio no diário após permissão explícita, com reprodução e descarte antes de salvar no IndexedDB;
- Perfil de Acolhimento opcional, editável e salvo automaticamente, com frases locais ajustadas pelas preferências e avaliações;
- relatórios resumidos por temas (11 seções fixas, sem reproduzir o diário completo) direcionados a psicologia, psiquiatria, medicina, terapia ocupacional, assistência social ou outro profissional, com prévia editável, controles de privacidade, anexo opcional dos registros completos e um prompt pronto (gratuito, sem conta, sem backend) para aprimorar o texto em qualquer IA que a pessoa já use — veja "Prompt para IA (opcional)" abaixo;
- respiração em cinco ciclos (4 segundos inspirando e 6 soltando), com pausa, continuação, foco preso no diálogo e redução de movimento;
- diário com título automático, sentimentos, intensidade, texto livre, campos “o que ajudou” e “o que piorou”;
- criação e edição com data/hora, identificador preservado e histórico de versões;
- pesquisa e filtros por sentimento e data;
- exclusão confirmada, impressão individual ou geral e relatório por período/seleção;
- diário no IndexedDB com migração automática da cópia antiga do localStorage;
- backup JSON versionado e restauração por mesclagem sem duplicatas ou substituição confirmada;
- contato de confiança por WhatsApp com mensagem preparada, confirmação manual de envio e atalhos para CVV 188 e SAMU 192;
- PWA instalável e funcional offline após o primeiro acesso.
- bloqueio opcional por PIN derivado com PBKDF2 (600 mil iterações) e cooldown progressivo após tentativas incorretas; com um PIN ativo, o diário, o plano de segurança, a caixa de acolhimento e o perfil passam a ser cifrados (AES-256-GCM) neste aparelho;
- telefone do contato mascarado, aviso explícito sobre backup sem criptografia e remoção confirmada da cópia legada após migração validada;
- sincronização opcional entre aparelhos por conta (e-mail/senha ou Google), com uma chave de sincronização própria que cifra os dados antes de qualquer envio ao Firestore — veja "Sincronização entre aparelhos" abaixo;
- links diretos corrigidos após o carregamento assíncrono e sugestões de múltiplos sentimentos para confirmação da pessoa;
- menu móvel compacto, navegação por áreas para reduzir a extensão da página e alvos de toque com pelo menos 44 px;
- limpeza de cópias antigas restrita à área avançada, condicionada a migração validada e backup recente;

## Executar localmente

Na pasta do projeto, inicie um servidor HTTP simples, por exemplo:

```bash
python -m http.server 8000
```

Abra `http://localhost:8000`. O servidor é necessário para testar o service worker e o modo offline.

## Dados e privacidade

Os registros usam o banco local `IndexedDB` (`portoSeguroDB`) e não são enviados pelo aplicativo para GitHub, Firebase ou outro serviço. Na primeira abertura, registros das chaves legadas `portoSeguro.diario.v2` ou `portoSeguro.diario.v1` são copiados e conferidos sem apagar a cópia antiga. O contato de confiança permanece em `localStorage` por ser uma configuração deste aparelho.

Sem um PIN configurado, o armazenamento fica em texto simples; com um PIN ativo, passa a ser cifrado neste aparelho. Sem ativar a sincronização (opcional, por conta), celular e computador não compartilham dados; além disso, localhost, Firebase e GitHub Pages mantêm dados locais separados. Limpar os dados do navegador pode apagar o diário. O modo anônimo não é adequado. Use **Baixar backup** regularmente e guarde o JSON onde preferir. Veja `privacidade.html`.

O Porto Seguro não diagnostica, não substitui terapia, atendimento médico ou serviço de emergência. Não há analytics, cookies publicitários ou coleta de informações fora da sincronização opcional que você mesma(o) ativa.

## Sincronização entre aparelhos (opcional)

Além do modo somente local (padrão), é possível criar uma conta (e-mail/senha ou Google) para acessar o mesmo diário, plano de segurança e relatórios em outro aparelho. Antes de qualquer envio, os dados são cifrados neste aparelho com uma **chave de sincronização** própria — um segredo separado da senha de login, pedido uma vez por conta e depois em cada novo aparelho. O Firestore nunca recebe texto simples, só o envelope cifrado. Fotos e áudios não sincronizam nesta versão (mesmo limite já existente no backup JSON local).

Para rodar esse recurso localmente (contribuindo com o projeto):

1. Instale a CLI do Firebase (`npm install -g firebase-tools`) e faça login (`firebase login`).
2. Em `sync.js`, substitua os valores de `CONFIGURACAO_FIREBASE` pelos do seu app Web (Console do Firebase → Configurações do projeto → Seus apps → Web). Os valores padrão só funcionam contra o emulador local.
3. Ative **Authentication** (métodos e-mail/senha e Google) e **Firestore** (região `southamerica-east1`, ou a de sua preferência) no [console do Firebase](https://console.firebase.google.com) para o projeto configurado em `.firebaserc`.
4. Para testar sem tocar em dados reais, use os emuladores: `firebase emulators:start --only auth,firestore`. Com o app aberto em `localhost`, `sync.js` se conecta neles automaticamente.
5. Para publicar as regras de segurança no projeto real: `firebase deploy --only firestore:rules`.

Veja `privacidade.html`, seção "Limites da sincronização", para os avisos completos sobre esse recurso — incluindo que a chave de sincronização não pode ser recuperada.

## Prompt para IA (opcional)

Além do resumo local por temas (sempre disponível, sem custo, sem IA, sem conta), o relatório oferece um botão **"Gerar prompt para IA"** que monta um texto pronto — já com as instruções de tom neutro, o banco de frases aprovado e os dados já resumidos localmente (sem o nome da pessoa, sem a seção de identificação) — para você copiar e colar em qualquer IA de sua confiança que já use gratuitamente: Claude (claude.ai), ChatGPT (chatgpt.com), Gemini (gemini.google.com) ou outra. Depois é só colar a resposta de volta no campo indicado e tocar em "Aplicar resposta ao relatório".

Esse fluxo é inteiramente local: nenhum dado sai do navegador automaticamente, não exige conta, plano pago, chave de API ou backend próprio — só o que você mesma(o) decide copiar e colar em outro serviço. A seção de situações de risco nunca é decidida pela IA: ela só pode reescrever o texto já determinado localmente por palavras-chave, e se a resposta colada mudar os achados (adicionar ou remover menção a plano, intenção, meios etc.), o app descarta a reescrita dessa seção e mantém o texto local automaticamente.

Veja `privacidade.html`, seção "Limites do prompt para IA", para os avisos completos sobre esse recurso.

## Publicar no GitHub Pages

1. Revise e envie os arquivos para a branch `main` de um repositório público.
2. Abra **Settings → Pages** no GitHub.
3. Em **Build and deployment**, selecione **Deploy from a branch**.
4. Escolha `main` e `/(root)`, depois salve.
5. Aguarde o endereço aparecer. Os caminhos do PWA são relativos e funcionam em subpastas do Pages.

## Limitações atuais e próximos recursos

- a sincronização entre aparelhos é opcional, só cobre texto (sem fotos/áudio) e depende de gatilhos automáticos (desbloqueio e reconexão), não é em tempo real;
- limites e disponibilidade do `IndexedDB` variam por navegador;
- o ícone atual é SVG; alguns dispositivos antigos podem exigir ícones PNG de 192 e 512 px;
- fotos e áudios ficam apenas no navegador e não são incluídos no backup JSON nem na sincronização;
- sincronizar fotos/áudios exigiria Firebase Storage e o plano pago (Blaze) do projeto — não incluído nesta etapa;
- o prompt para IA depende de colar manualmente a resposta em um serviço de terceiros (fora do controle do Porto Seguro); a qualidade e a privacidade dessa etapa seguem as políticas do serviço de IA escolhido pela própria pessoa;
- as listas de palavras-chave usadas no resumo local e na detecção de situações de risco são um ponto de partida razoável, mas ainda não passaram por revisão clínica formal; elas podem gerar falsos positivos e falsos negativos.
