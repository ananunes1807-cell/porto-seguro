# Porto Seguro — beta

Aplicativo web de apoio emocional, respiração guiada e diário local. A frase central é: “Podemos te apoiar, mas, primeiramente, não se esqueça de você.”

**Acesse o aplicativo:** [https://porto-seguro-ananunes.web.app](https://porto-seguro-ananunes.web.app)

## Recursos disponíveis

- fluxo de apoio progressivo, mensagem de regulação e opções de ajuda humana;
- respiração em cinco ciclos (4 segundos inspirando e 6 soltando), com pausa, continuação, foco preso no diálogo e redução de movimento;
- diário com título automático, sentimentos, intensidade, texto livre, campos “o que ajudou” e “o que piorou”;
- criação e edição com data/hora, identificador preservado e histórico de versões;
- pesquisa e filtros por sentimento e data;
- exclusão confirmada, impressão individual ou geral e relatório por período/seleção;
- diário no IndexedDB com migração automática da cópia antiga do localStorage;
- backup JSON versionado e restauração por mesclagem sem duplicatas ou substituição confirmada;
- contato de confiança por WhatsApp com mensagem preparada, confirmação manual de envio e atalhos para CVV 188 e SAMU 192;
- PWA instalável e funcional offline após o primeiro acesso.

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
- áudio não foi incluído: uma versão futura deve solicitar microfone somente ao tocar em gravar e armazenar áudio localmente em IndexedDB;
- IA online exigiria consentimento, política de privacidade e backend seguro; nenhuma chave de API existe neste projeto.
