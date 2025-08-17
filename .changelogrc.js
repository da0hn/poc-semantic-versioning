const preset = require('conventional-changelog-conventionalcommits');

module.exports = preset({
  releaseCount: 0,
  types: [
    { type: 'feat',     section: 'Novidades' },
    { type: 'fix',      section: 'Correções' },
    { type: 'perf',     section: 'Desempenho' },
    { type: 'revert',   section: 'Reversões' },
    { type: 'ci',       section: 'CI/CD',        hidden: false },
    { type: 'chore',    section: 'Manutenção',   hidden: false },
    { type: 'build',    section: 'Build',        hidden: false },
    { type: 'refactor', section: 'Refatoração',  hidden: false },
    { type: 'style',    section: 'Estilo',       hidden: false },
    { type: 'test',     section: 'Testes',       hidden: false },
  ],
});
