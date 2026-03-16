const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://rxrodfskmvldozpznyrp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rm-U3aeXydu4W0wdSMLW5w_I4LIW5MO';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function check() {
    const { data, error } = await supabase
        .from('participantes')
        .select('nit, consumo, created_at')
        .eq('nit', '4');
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Registros para NIT 4:');
    let total = 0;
    data.forEach(p => {
        const monto = parseFloat(p.consumo.toString().replace(/[^0-9.]/g, '')) || 0;
        total += monto;
        console.log(`- Fecha: ${p.created_at}, Consumo: ${p.consumo} (Parsed: ${monto})`);
    });
    console.log('TOTAL ACUMULADO CALCULADO:', total);
}

check();
