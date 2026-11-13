from pathlib import Path
root=Path(__file__).parent
s=(root/'render_with_word_pdf.py').read_text(encoding='utf-8')
s=s.replace('qa/summary-final.pdf','qa-responsibilities/summary-v2.pdf').replace("root/'qa'","root/'qa-responsibilities'")
exec(compile(s,'render_with_word_pdf.py','exec'))
