// Regra da quantidade de guias quando o PDF traz "X/Y" (ex.: 10/07).
// 'maior' conta o maior número; 'menor' conta o menor.
export const REGRA_GUIAS = process.env.FATURALE_REGRA_GUIAS || 'maior';

export const PORTA = Number(process.env.PORT || 3000);

// Modo de teste: mostra o acesso rápido dos usuários de teste na tela de login.
export const MODO_TESTE = process.env.FATURALE_MODO_TESTE !== '0';
