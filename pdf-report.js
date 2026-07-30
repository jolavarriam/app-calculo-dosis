/**
 * DosisCalc — Generador de informe PDF (tamaño carta).
 * Usa jsPDF (vendorizado en vendor/jspdf.umd.min.js, MIT license) para poder
 * generar el PDF sin conexión una vez que la PWA quedó instalada/cacheada.
 *
 * Expone window.DosisPDF.generate(reportState) donde reportState es:
 * {
 *   sections: [ { title, rows: [{ label, value, unit }] } ],
 *   finalResult: { label, value, unit },
 *   fileName: string
 * }
 */
(function () {
  "use strict";

  const BRAND = {
    ink: [15, 23, 42], // #0f172a
    accent: [156, 111, 46], // versión oscura del ámbar, legible sobre blanco
    accentLight: [246, 233, 216], // fondo claro para franjas / cajas
    textMuted: [95, 105, 120],
    line: [223, 226, 232],
  };

  const PAGE = {
    format: "letter", // 215.9 x 279.4 mm
    marginX: 18,
    marginTop: 20,
    marginBottom: 18,
  };

  function formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    const fecha = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    const hora = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `${fecha} · ${hora}`;
  }

  function drawHeader(doc, pageWidth) {
    const { marginX, marginTop } = PAGE;

    // Isotipo "DC"
    doc.setFillColor(...BRAND.ink);
    doc.roundedRect(marginX, marginTop - 6, 10, 10, 2, 2, "F");
    doc.setTextColor(217, 168, 108);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("DC", marginX + 5, marginTop - 0.3, { align: "center" });

    // Nombre de marca
    doc.setTextColor(...BRAND.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("DosisCalc", marginX + 14, marginTop);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.textMuted);
    doc.text("Informe de cálculo de dosis de aplicación", marginX + 14, marginTop + 5);

    // Fecha de generación, alineada a la derecha
    doc.setFontSize(8.5);
    doc.text(`Generado: ${formatTimestamp(new Date())}`, pageWidth - marginX, marginTop, { align: "right" });

    const ruleY = marginTop + 8;
    doc.setDrawColor(...BRAND.line);
    doc.setLineWidth(0.4);
    doc.line(marginX, ruleY, pageWidth - marginX, ruleY);

    return ruleY + 7; // próxima posición Y disponible
  }

  function drawFooter(doc, pageWidth, pageHeight) {
    const { marginX, marginBottom } = PAGE;
    const y = pageHeight - marginBottom + 8;
    doc.setDrawColor(...BRAND.line);
    doc.setLineWidth(0.3);
    doc.line(marginX, y - 5, pageWidth - marginX, y - 5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.textMuted);
    doc.text(
      "Los rangos de validación son referenciales. Ajusta según tu criterio agronómico.",
      marginX,
      y
    );

    const pageCount = doc.getNumberOfPages();
    const current = doc.getCurrentPageInfo().pageNumber;
    doc.text(`Página ${current} de ${pageCount}`, pageWidth - marginX, y, { align: "right" });
  }

  function ensureSpace(doc, y, needed, pageWidth, pageHeight) {
    if (y + needed > pageHeight - PAGE.marginBottom) {
      doc.addPage();
      return drawHeader(doc, pageWidth);
    }
    return y;
  }

  function drawSectionTitle(doc, y, title, pageWidth) {
    const { marginX } = PAGE;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...BRAND.ink);
    doc.text(title, marginX, y);

    doc.setDrawColor(...BRAND.accent);
    doc.setLineWidth(0.6);
    doc.line(marginX, y + 1.6, marginX + 14, y + 1.6);

    return y + 7;
  }

  function drawRow(doc, y, row, index, pageWidth) {
    const { marginX } = PAGE;
    const contentWidth = pageWidth - marginX * 2;
    const rowHeight = 6.3;

    if (index % 2 === 0) {
      doc.setFillColor(...BRAND.accentLight);
      doc.rect(marginX, y - 4.1, contentWidth, rowHeight, "F");
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.3);
    doc.setTextColor(...BRAND.ink);
    doc.text(row.label, marginX + 2.5, y);

    const valueText = row.unit ? `${row.value} ${row.unit}` : row.value;
    doc.setFont("courier", "bold");
    doc.setFontSize(9.3);
    doc.setTextColor(...BRAND.accent);
    doc.text(valueText, pageWidth - marginX - 2.5, y, { align: "right" });

    return y + rowHeight;
  }

  function drawFinalResult(doc, y, finalResult, pageWidth) {
    const { marginX } = PAGE;
    const boxWidth = pageWidth - marginX * 2;
    const boxHeight = 24;

    doc.setFillColor(...BRAND.ink);
    doc.roundedRect(marginX, y, boxWidth, boxHeight, 3, 3, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(217, 168, 108);
    doc.text(finalResult.label.toUpperCase(), marginX + boxWidth / 2, y + 7.5, { align: "center" });

    doc.setFont("courier", "bold");
    doc.setFontSize(19);
    doc.setTextColor(245, 245, 244);
    doc.text(finalResult.value, marginX + boxWidth / 2, y + 16.5, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(217, 168, 108);
    doc.text(finalResult.unit, marginX + boxWidth / 2, y + 21, { align: "center" });

    return y + boxHeight + 6;
  }

  function generate(reportState) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("jsPDF no está disponible todavía.");
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: PAGE.format, compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    let y = drawHeader(doc, pageWidth);

    reportState.sections.forEach((section) => {
      y = ensureSpace(doc, y, 10 + section.rows.length * 6.3, pageWidth, pageHeight);
      y = drawSectionTitle(doc, y, section.title, pageWidth);
      section.rows.forEach((row, i) => {
        y = ensureSpace(doc, y, 6.3, pageWidth, pageHeight);
        y = drawRow(doc, y, row, i, pageWidth);
      });
      y += 2.5;
    });

    y = ensureSpace(doc, y, 30, pageWidth, pageHeight);
    drawFinalResult(doc, y, reportState.finalResult, pageWidth);

    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      drawFooter(doc, pageWidth, pageHeight);
    }

    doc.save(reportState.fileName);
  }

  window.DosisPDF = { generate };
})();
