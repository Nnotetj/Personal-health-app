// แถบ Safety / Disclaimer แสดงถาวร (ไม่ซ่อน ไม่มีปุ่มปิด) ไม่ถูกพิมพ์ลงเอกสาร
export default function SafetyBar({ fixed = true }) {
  return (
    <aside className={fixed ? 'safety-bar fixed no-print' : 'safety-bar no-print'} role="note" aria-label="ข้อความด้านความปลอดภัย">
      <strong>Safety</strong>
      <span>
        ระบบนี้เป็นเครื่องมือช่วยแพทย์ ไม่ใช่การวินิจฉัยหรือคำแนะนำทางการแพทย์ ข้อความที่ AI ร่างต้องผ่านการตรวจทานโดยแพทย์ก่อนใช้งานจริง
        ข้อมูลในเว็บนี้เป็นข้อมูลสมมติเพื่อการสาธิต
      </span>
      <span lang="en" className="safety-en">
        Clinical decision support only — not a diagnosis. AI drafts must be reviewed by a physician. All data shown is fictional, for demonstration.
      </span>
    </aside>
  )
}
