// Public, non-sensitive application defaults only. Institutional records come from authenticated APIs.
const APP_DATA = {
    institution: {
        name: "Colegio Reinaldo Matiz",
        sede: "",
        municipio: "",
        department: "",
        teacher: "",
        year: String(new Date().getFullYear())
    },
    students: [],
    teachers: [],
    piars: [],
    reportTypes: ["Seguimiento individual", "Avance de objetivos", "Comité institucional"],
    // Reference catalogs (MEN, Decreto 1421 de 2017 and Ley 115 de 1994).
    discapacidades: [
        "Por caracterizar", "Discapacidad física", "Discapacidad auditiva", "Discapacidad visual",
        "Sordoceguera", "Discapacidad intelectual", "Discapacidad psicosocial", "Discapacidad sistémica",
        "Discapacidad múltiple", "Trastorno del espectro autista", "Trastorno específico del aprendizaje"
    ],
    grados: ["Transición", "Primero", "Segundo", "Tercero", "Cuarto", "Quinto", "Sexto", "Séptimo", "Octavo", "Noveno", "Décimo", "Undécimo"],
    areas: [
        "Matemáticas", "Lengua castellana", "Inglés", "Ciencias naturales", "Ciencias sociales",
        "Educación artística", "Educación física", "Ética y valores", "Educación religiosa",
        "Tecnología e informática", "Filosofía", "Transversal"
    ]
};

window.APP_DATA = APP_DATA;
