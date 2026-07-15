const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DOCS_ROOT = path.join(REPO_ROOT, 'docs');

function listMarkdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.md') ? [absolutePath] : [];
  });
}

function collectViolations(source, file, rule) {
  return source.split(/\r?\n/).flatMap((line, index) => (
    rule.pattern.test(line)
      ? [`${path.relative(REPO_ROOT, file)}:${index + 1} ${rule.label}: ${line.trim()}`]
      : []
  ));
}

describe('统一认证文档治理静态门禁', () => {
  test('docs 不得继续指导 SystemSwitch 携带 Token 或路由守卫接收 URL Token', () => {
    const rules = [
      {
        label: 'SystemSwitch 携带 Token',
        pattern: /SystemSwitch[^\r\n]{0,120}(?<!不)(?:携带|附带|拼接)\s*(?:ERP\s*)?(?:token|Token)/
      },
      {
        label: 'SystemSwitch Token URL 接收/传递',
        pattern: /SystemSwitch[^\r\n]{0,120}(?:(?:token|Token)\s*URL\s*接收|URL\s*(?:token|Token)\s*接收)/
      },
      {
        label: '路由守卫接收 Token',
        pattern: /路由守卫[^\r\n]{0,80}(?:token|Token)\s*(?:接收|写入|保存)/
      },
      {
        label: '路由守卫读取 URL Token',
        pattern: /路由守卫[^\r\n]{0,120}(?:query\.token|route\.query\.token|[?&]token=)/
      }
    ];

    const violations = [];
    for (const file of listMarkdownFiles(DOCS_ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const rule of rules) violations.push(...collectViolations(source, file, rule));
    }

    expect(violations).toEqual([]);
  });

  test('主项目集成指南只能推荐一次性 Code，明确返回主项目不携带 Token', () => {
    const source = fs.readFileSync(
      path.join(DOCS_ROOT, 'T21-main-project-integration.md'),
      'utf8'
    );

    expect(source).toMatch(/一次性\s*Code|一次性授权码/);
    expect(source).toMatch(/不携带\s*(?:Token|token)/);
    expect(source).not.toMatch(/[?&]token=/i);
    expect(source).not.toMatch(/query\.token/i);
    expect(source).not.toMatch(/localStorage\.setItem\([^\r\n]*(?:token|Token)/);
  });

  test('R7 文档中的 callback、exchange 和 authorize 响应必须携带正确 state 契约', () => {
    const callbackViolations = [];
    for (const file of listMarkdownFiles(DOCS_ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      source.split(/\r?\n/).forEach((line, index) => {
        if (line.includes('/sso/callback?code=') && !line.includes('&state=')) {
          callbackViolations.push(`${path.relative(REPO_ROOT, file)}:${index + 1}`);
        }
      });
    }
    expect(callbackViolations).toEqual([]);

    const confirmation = fs.readFileSync(
      path.join(DOCS_ROOT, '2026-07-10-主项目统一权限与SSO联调确认回填表.md'),
      'utf8'
    );
    expect(confirmation).toContain('"state": "ERP生成并绑定当前浏览器的state"');
    expect(confirmation).toContain('`authorizationCode/state/audience/redirectUri`');

    const handoff = fs.readFileSync(
      path.join(DOCS_ROOT, '2026-07-10-主项目统一ERP权限与SSO改造交接文档.md'),
      'utf8'
    );
    const authorizeResponse = handoff.match(/成功响应：[\s\S]*?服务端流程：/)?.[0] || '';
    expect(authorizeResponse).toContain('"redirectUrl"');
    expect(authorizeResponse).not.toContain('"authorizationCode"');
  });
});
