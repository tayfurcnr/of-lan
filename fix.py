content = open('public/js/app.js', encoding='utf-8').read()
content = content.replace('}\\r\\n\\r\\nfunction getInlineFileIcon(kind) {\\r\\n    const lower', '}\r\n\r\nfunction getInlineFileIcon(kind) {\r\n    const lower')
open('public/js/app.js', 'w', encoding='utf-8').write(content)
print('done')
