import importlib.util
import os
from pathlib import Path

root=Path(__file__).parent
runtime=Path('C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime')
os.environ['PATH']=str(runtime/'dependencies/native/poppler/Library/bin')+os.pathsep+os.environ['PATH']
script=runtime/'plugins/openai-primary-runtime/plugins/documents/skills/documents/render_docx.py'
spec=importlib.util.spec_from_file_location('docx_renderer',script)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
# Windows runtime does not bundle LibreOffice. The input PDF was exported by Word.
module.convert_to_pdf=lambda *args,**kwargs:(str(root/'qa/summary-final.pdf'),'Microsoft Word PDF export')
module.rasterize(str(root/'สรุประบบ_Water_System.docx'),str(root/'qa'),150,False,False)
print('Rendered all pages from Word export')
