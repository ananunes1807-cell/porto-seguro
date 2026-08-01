const CHAVE_DIARIO = 'portoSeguro.diario.v1';

const botaoAjuda = document.querySelector('.botao-ajuda');
const areaApoio = document.querySelector('#area-apoio');
const botaoRespirar = document.querySelector('.botao-respirar');
const telaRespiracao = document.querySelector('#tela-respiracao');
const instrucaoRespiracao = document.querySelector('#instrucao-respiracao');
const numeroRespiracao = document.querySelector('#numero-respiracao');
const botaoPararRespiracao = document.querySelector('#parar-respiracao');

const botaoDiario = document.querySelector('.botao-diario');
const areaDiario = document.querySelector('#area-diario');
const botaoFecharDiario = document.querySelector('#fechar-diario');
const formDiario = document.querySelector('#form-diario');
const registroId = document.querySelector('#registro-id');
const tituloRegistro = document.querySelector('#titulo-registro');
const sentimentoRegistro = document.querySelector('#sentimento-registro');
const intensidadeRegistro = document.querySelector('#intensidade-registro');
const textoRegistro = document.querySelector('#texto-registro');
const botaoSugerirSentimento = document.querySelector('#sugerir-sentimento');
const mensagemSugestao = document.querySelector('#mensagem-sugestao');
const statusEdicao = document.querySelector('#status-edicao');
const botaoCancelarEdicao = document.querySelector('#cancelar-edicao');
const botaoSalvarRegistro = document.querySelector('#salvar-registro');
const listaRegistros = document.querySelector('#lista-registros');
const contadorRegistros = document.querySelector('#contador-registros');
const modeloRegistro = document.querySelector('#modelo-registro');
const botaoImprimir = document.querySelector('#imprimir-diario');
const botaoBackup = document.querySelector('#baixar-backup');
const botaoRestaurarBackup = document.querySelector('#restaurar-backup');
const arquivoBackup = document.querySelector('#arquivo-backup');

let temporizadorRespiracao;
let respiracaoAtiva = false;
let cicloAtual = 0;
const totalCiclos = 5;

let registros = carregarRegistros();

function carregarRegistros() {
    try {
        const salvos = JSON.parse(localStorage.getItem(CHAVE_DIARIO) || '[]');
        return Array.isArray(salvos) ? salvos : [];
    } catch (erro) {
        console.error('Não foi possível ler o diário salvo.', erro);
        return [];
    }
}

function persistirRegistros() {
    localStorage.setItem(CHAVE_DIARIO, JSON.stringify(registros));
}

function criarId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatarData(data) {
    return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
    }).format(new Date(data));
}

function gerarTitulo(texto, sentimento) {
    const palavras = texto.trim().split(/\s+/).slice(0, 7).join(' ');

    if (palavras) {
        return texto.trim().split(/\s+/).length > 7 ? `${palavras}…` : palavras;
    }

    if (sentimento) {
        return `Registro de ${sentimento.toLowerCase()}`;
    }

    return 'Meu registro';
}

function abrirDiario() {
    areaDiario.hidden = false;
    botaoDiario.setAttribute('aria-expanded', 'true');
    botaoDiario.textContent = 'Diário aberto';
    renderizarRegistros();
    areaDiario.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fecharDiario() {
    areaDiario.hidden = true;
    botaoDiario.setAttribute('aria-expanded', 'false');
    botaoDiario.textContent = 'Abrir meu diário';
    botaoDiario.focus();
}

function limparFormulario() {
    formDiario.reset();
    registroId.value = '';
    mensagemSugestao.textContent = '';
    statusEdicao.hidden = true;
    botaoCancelarEdicao.hidden = true;
    botaoSalvarRegistro.textContent = 'Salvar no meu aparelho';
}

function salvarRegistro(evento) {
    evento.preventDefault();

    const texto = textoRegistro.value.trim();
    if (!texto) {
        textoRegistro.focus();
        return;
    }

    const agora = new Date().toISOString();
    const sentimento = sentimentoRegistro.value.trim();
    const intensidade = intensidadeRegistro.value === 'nao-sei'
        ? null
        : Number(intensidadeRegistro.value);
    const titulo = tituloRegistro.value.trim() || gerarTitulo(texto, sentimento);

    if (registroId.value) {
        const indice = registros.findIndex((item) => item.id === registroId.value);

        if (indice !== -1) {
            const anterior = registros[indice];
            const versaoAnterior = {
                title: anterior.title,
                feeling: anterior.feeling,
                intensity: anterior.intensity,
                text: anterior.text,
                savedAt: anterior.updatedAt || anterior.createdAt
            };

            registros[indice] = {
                ...anterior,
                title: titulo,
                feeling: sentimento,
                intensity: intensidade,
                text: texto,
                updatedAt: agora,
                history: [...(anterior.history || []), versaoAnterior]
            };
        }
    } else {
        registros.unshift({
            id: criarId(),
            title: titulo,
            feeling: sentimento,
            intensity: intensidade,
            text: texto,
            createdAt: agora,
            updatedAt: null,
            history: []
        });
    }

    persistirRegistros();
    limparFormulario();
    renderizarRegistros();
    contadorRegistros.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function editarRegistro(id) {
    const registro = registros.find((item) => item.id === id);
    if (!registro) return;

    registroId.value = registro.id;
    tituloRegistro.value = registro.title;
    sentimentoRegistro.value = registro.feeling || '';
    intensidadeRegistro.value = registro.intensity === null ? 'nao-sei' : String(registro.intensity);
    textoRegistro.value = registro.text;
    statusEdicao.hidden = false;
    botaoCancelarEdicao.hidden = false;
    botaoSalvarRegistro.textContent = 'Salvar alterações';
    formDiario.scrollIntoView({ behavior: 'smooth', block: 'start' });
    tituloRegistro.focus({ preventScroll: true });
}

function excluirRegistro(id) {
    const registro = registros.find((item) => item.id === id);
    if (!registro) return;

    const confirmou = window.confirm(
        `ATENÇÃO: excluir “${registro.title}” apagará este registro e seu histórico deste aparelho. Essa ação não pode ser desfeita. Deseja continuar?`
    );

    if (!confirmou) return;

    registros = registros.filter((item) => item.id !== id);
    persistirRegistros();

    if (registroId.value === id) {
        limparFormulario();
    }

    renderizarRegistros();
}

function renderizarRegistros() {
    listaRegistros.replaceChildren();

    if (registros.length === 0) {
        contadorRegistros.textContent = 'Nenhum registro salvo ainda.';
        return;
    }

    contadorRegistros.textContent = registros.length === 1
        ? '1 registro salvo neste aparelho.'
        : `${registros.length} registros salvos neste aparelho.`;

    const ordenados = [...registros].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    ordenados.forEach((registro) => {
        const fragmento = modeloRegistro.content.cloneNode(true);
        const card = fragmento.querySelector('.card-registro');

        fragmento.querySelector('.registro-titulo').textContent = registro.title;
        fragmento.querySelector('.registro-data').textContent = `Criado em ${formatarData(registro.createdAt)}`;
        fragmento.querySelector('.registro-intensidade').textContent = registro.intensity === null
            ? 'Intensidade: não sei'
            : `Intensidade: ${registro.intensity}/10`;

        const sentimento = fragmento.querySelector('.registro-sentimento');
        sentimento.textContent = registro.feeling ? `Sentimento: ${registro.feeling}` : 'Sentimento não informado';

        fragmento.querySelector('.registro-texto').textContent = registro.text;

        const edicao = fragmento.querySelector('.registro-edicao');
        if (registro.updatedAt) {
            const totalVersoes = (registro.history || []).length;
            edicao.textContent = `Editado em ${formatarData(registro.updatedAt)} · ${totalVersoes} versão(ões) anterior(es) preservada(s)`;
        } else {
            edicao.remove();
        }

        fragmento.querySelector('.editar-registro').addEventListener('click', () => editarRegistro(registro.id));
        fragmento.querySelector('.excluir-registro').addEventListener('click', () => excluirRegistro(registro.id));
        card.dataset.id = registro.id;
        listaRegistros.appendChild(fragmento);
    });
}

function sugerirSentimento() {
    const texto = textoRegistro.value.toLocaleLowerCase('pt-BR');

    if (!texto.trim()) {
        mensagemSugestao.textContent = 'Escreva um pouco primeiro. Depois eu tento sugerir uma palavra para o sentimento.';
        textoRegistro.focus();
        return;
    }

    const possibilidades = [
        { sentimento: 'Ansiedade', palavras: ['ansied', 'aperto', 'preocup', 'nervos', 'agoni', 'acelerad'] },
        { sentimento: 'Tristeza', palavras: ['trist', 'chor', 'vazio', 'desanim', 'machuc', 'decepcion'] },
        { sentimento: 'Raiva', palavras: ['raiva', 'ódio', 'irrit', 'brava', 'revolt', 'injust'] },
        { sentimento: 'Medo', palavras: ['medo', 'pânico', 'assust', 'perigo', 'insegur'] },
        { sentimento: 'Cansaço', palavras: ['cans', 'exaust', 'sem energia', 'esgot'] },
        { sentimento: 'Solidão', palavras: ['sozinha', 'sozinho', 'solid', 'abandon', 'ninguém'] },
        { sentimento: 'Confusão', palavras: ['confus', 'não sei', 'perdida', 'perdido', 'mistur'] },
        { sentimento: 'Alegria', palavras: ['feliz', 'alegr', 'animad', 'orgulho', 'consegui'] },
        { sentimento: 'Calma', palavras: ['calma', 'calmo', 'tranquil', 'alívio', 'aliviad'] }
    ];

    const encontrada = possibilidades.find((opcao) =>
        opcao.palavras.some((palavra) => texto.includes(palavra))
    );

    if (!encontrada) {
        mensagemSugestao.textContent = 'Não consegui identificar com segurança. Tudo bem escrever “não sei” ou deixar em branco.';
        return;
    }

    sentimentoRegistro.value = encontrada.sentimento;
    mensagemSugestao.textContent = `Sugestão: ${encontrada.sentimento}. Veja se essa palavra combina com você e mude se não combinar.`;
}

function baixarBackup() {
    if (registros.length === 0) {
        window.alert('Ainda não há registros para incluir no backup.');
        return;
    }

    const conteudo = JSON.stringify({
        app: 'Porto Seguro',
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: registros
    }, null, 2);
    const arquivo = new Blob([conteudo], { type: 'application/json' });
    const url = URL.createObjectURL(arquivo);
    const link = document.createElement('a');
    const data = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `porto-seguro-backup-${data}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function restaurarBackup(evento) {
    const [arquivo] = evento.target.files;
    if (!arquivo) return;

    const leitor = new FileReader();

    leitor.addEventListener('load', () => {
        try {
            const backup = JSON.parse(leitor.result);

            if (backup.app !== 'Porto Seguro' || !Array.isArray(backup.entries)) {
                throw new Error('Formato de backup não reconhecido.');
            }

            const validos = backup.entries.filter((item) =>
                item && typeof item.id === 'string' && typeof item.text === 'string' && item.createdAt
            );

            if (validos.length === 0) {
                throw new Error('O backup não possui registros válidos.');
            }

            const confirmou = window.confirm(
                `Este backup contém ${validos.length} registro(s). Eles serão combinados com os registros deste aparelho. Registros com o mesmo identificador serão atualizados. Deseja continuar?`
            );

            if (!confirmou) return;

            const combinados = new Map(registros.map((item) => [item.id, item]));
            validos.forEach((item) => combinados.set(item.id, item));
            registros = Array.from(combinados.values());
            persistirRegistros();
            renderizarRegistros();
            window.alert('Backup restaurado com sucesso neste aparelho.');
        } catch (erro) {
            window.alert(`Não foi possível restaurar este arquivo. ${erro.message}`);
        } finally {
            arquivoBackup.value = '';
        }
    });

    leitor.readAsText(arquivo);
}

function mostrarContagem(texto, segundos, proximaEtapa) {
    instrucaoRespiracao.textContent = texto;
    numeroRespiracao.textContent = segundos;

    temporizadorRespiracao = window.setInterval(() => {
        segundos -= 1;

        if (segundos > 0) {
            numeroRespiracao.textContent = segundos;
        } else {
            clearInterval(temporizadorRespiracao);
            proximaEtapa();
        }
    }, 1000);
}

function inspirar() {
    if (!respiracaoAtiva) return;

    if (cicloAtual >= totalCiclos) {
        finalizarRespiracao();
        return;
    }

    cicloAtual += 1;
    mostrarContagem(`Inspire devagar — ciclo ${cicloAtual} de ${totalCiclos}`, 4, soltar);
}

function soltar() {
    if (!respiracaoAtiva) return;
    mostrarContagem('Solte o ar devagar', 6, inspirar);
}

function iniciarRespiracao() {
    clearInterval(temporizadorRespiracao);
    cicloAtual = 0;
    respiracaoAtiva = true;
    telaRespiracao.hidden = false;
    botaoPararRespiracao.textContent = 'Parar';
    document.body.classList.add('sem-rolagem');
    inspirar();
    botaoPararRespiracao.focus();
}

function pararRespiracao() {
    clearInterval(temporizadorRespiracao);
    respiracaoAtiva = false;
    telaRespiracao.hidden = true;
    document.body.classList.remove('sem-rolagem');
    botaoRespirar.focus();
}

function finalizarRespiracao() {
    clearInterval(temporizadorRespiracao);
    respiracaoAtiva = false;
    instrucaoRespiracao.textContent = 'Você concluiu. Perceba como está se sentindo agora.';
    numeroRespiracao.textContent = '✓';
    botaoPararRespiracao.textContent = 'Fechar';
}

botaoAjuda.addEventListener('click', () => {
    areaApoio.hidden = false;
    areaApoio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

botaoRespirar.addEventListener('click', iniciarRespiracao);
botaoPararRespiracao.addEventListener('click', pararRespiracao);
botaoDiario.addEventListener('click', abrirDiario);
botaoFecharDiario.addEventListener('click', fecharDiario);
formDiario.addEventListener('submit', salvarRegistro);
botaoCancelarEdicao.addEventListener('click', limparFormulario);
botaoSugerirSentimento.addEventListener('click', sugerirSentimento);
botaoImprimir.addEventListener('click', () => window.print());
botaoBackup.addEventListener('click', baixarBackup);
botaoRestaurarBackup.addEventListener('click', () => arquivoBackup.click());
arquivoBackup.addEventListener('change', restaurarBackup);

document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !telaRespiracao.hidden) {
        pararRespiracao();
    }
});

renderizarRegistros();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch((erro) => {
            console.info('O modo offline ainda não pôde ser ativado.', erro);
        });
    });
}
