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
- relatórios locais direcionados a psicologia, psiquiatria, medicina, terapia ocupacional, assistência social ou outro profissional, com prévia editável e salvamento opcional;
- respiração em cinco ciclos (4 segundos inspirando e 6 soltando), com pausa, continuação, foco preso no diálogo e redução de movimento;
- diário com título automático, sentimentos, intensidade, texto livre, campos “o que ajudou” e “o que piorou”;
- criação e edição com data/hora, identificador preservado e histórico de versões;
- pesquisa e filtros por sentimento e data;
- exclusão confirmada, impressão individual ou geral e relatório por período/seleção;
- diário no IndexedDB com migração automática da cópia antiga do localStorage;
- backup JSON versionado e restauração por mesclagem sem duplicatas ou substituição confirmada;
- contato de confiança por WhatsApp com mensagem preparada, confirmação manual de envio e atalhos para CVV 188 e SAMU 192;
- PWA instalável e funcional offline após o primeiro acesso.
- bloqueio opcional por PIN derivado com PBKDF2, botão de bloqueio imediato e bloqueio por inatividade; o PIN não criptografa os dados;
- telefone do contato mascarado, aviso explícito sobre backup sem criptografia e remoção confirmada da cópia legada após migração validada;
- links diretos corrigidos após o carregamento assíncrono e sugestões de múltiplos sentimentos para confirmação da pessoa;

## Executar localmente

Na pasta do projeto, inicie um servidor HTTP simples, por exemplo:

```bash
python -m http.server 8000
```

Abra `http://localhost:8000`. O servidor é necessário para testar o service worker e o modo offline.

## Dados e privacidade

Os registros usam o banco local `IndexedDB` (`portoSeguroDB`) e não são enviados pelo aplicativo para GitHub, Firebase ou outro serviço. Na primeira abertura, registros das chaves legadas `portoSeguro.diario.v2` ou `portoSeguro.diario.v1` são copiados e conferidos sem apagar a cópia antiga. O contato de confiança permanece em `localStorage` por ser uma configuração deste aparelho.

O armazenamento não é criptografado. Celular e computador ainda não sincronizam; além disso, localhost, Firebase e GitHub Pages mantêm dados separados. Limpar os dados do navegador pode apagar o diário. O modo anônimo não é adequado. Use **Baixar backup** regularmente e guarde o JSON onde preferir. Veja `privacidade.html`.

O Porto Seguro não diagnostica, não substitui terapia, atendimento médico ou serviço de emergência. Não há analytics, cookies publicitários ou coleta de informações.

## Publicar no GitHub Pages

1. Revise e envie os arquivos para a branch `main` de um repositório público.
2. Abra **Settings → Pages** no GitHub.
3. Em **Build and deployment**, selecione **Deploy from a branch**.
4. Escolha `main` e `/(root)`, depois salve.
5. Aguarde o endereço aparecer. Os caminhos do PWA são relativos e funcionam em subpastas do Pages.

## Limitações atuais e próximos recursos

- os dados não sincronizam entre aparelhos ou origens diferentes;
- limites e disponibilidade do `IndexedDB` variam por navegador;
- o ícone atual é SVG; alguns dispositivos antigos podem exigir ícones PNG de 192 e 512 px;
- fotos e áudios ficam apenas no navegador e não são incluídos no backup JSON;
- IA online exigiria consentimento, política de privacidade e backend seguro; nenhuma chave de API existe neste projeto.
- a organização atual dos relatórios é inteiramente local; a arquitetura futura de IA não está exposta na interface e nenhum dado é transmitido.
