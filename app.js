const SUPABASE_URL = 'https://xrniyskwpkkxyeaoawnx.supabase.co'
const SUPABASE_KEY = 'sb_publishable_lmR2ZfAbTZFOhW7o6U-UVQ_6LMH8XOm'

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

let currentUser = null
let currentProfile = null
let cars = []
let rentals = []
let rentalChart = null
let selectedCar = null

const authPage = document.getElementById('authPage')
const appPage = document.getElementById('appPage')
const loginForm = document.getElementById('loginForm')
const registerForm = document.getElementById('registerForm')
const loginTab = document.getElementById('loginTab')
const registerTab = document.getElementById('registerTab')
const authMessage = document.getElementById('authMessage')
const logoutBtn = document.getElementById('logoutBtn')

const rentModal = new bootstrap.Modal(document.getElementById('rentModal'))
const carModal = new bootstrap.Modal(document.getElementById('carModal'))

function formatMoney(value) {
    return `₮${Number(value || 0).toLocaleString()}`
}

function formatDate(date) {
    if (!date) return '-'

    return new Date(`${date}T00:00:00`).toLocaleDateString('mn-MN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    })
}

function escapeHTML(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
}

function showAuthMessage(message, type = 'danger') {
    authMessage.innerHTML = `
        <div class="alert alert-${type}">
            ${escapeHTML(message)}
        </div>
    `
}

function clearAuthMessage() {
    authMessage.innerHTML = ''
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer')
    const id = `toast-${Date.now()}`

    container.insertAdjacentHTML('beforeend', `
        <div id="${id}" class="toast align-items-center border-0 text-bg-${type}" role="alert">
            <div class="d-flex">
                <div class="toast-body">
                    ${escapeHTML(message)}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `)

    const element = document.getElementById(id)
    const toast = new bootstrap.Toast(element, { delay: 3000 })

    toast.show()

    element.addEventListener('hidden.bs.toast', () => {
        element.remove()
    })
}

function showLogin() {
    loginForm.classList.remove('d-none')
    registerForm.classList.add('d-none')

    loginTab.classList.add('active')
    registerTab.classList.remove('active')

    clearAuthMessage()
}

function showRegister() {
    registerForm.classList.remove('d-none')
    loginForm.classList.add('d-none')

    registerTab.classList.add('active')
    loginTab.classList.remove('active')

    clearAuthMessage()
}

loginTab.addEventListener('click', showLogin)
registerTab.addEventListener('click', showRegister)

registerForm.addEventListener('submit', async event => {
    event.preventDefault()

    clearAuthMessage()

    const fullName = document.getElementById('registerName').value.trim()
    const email = document.getElementById('registerEmail').value.trim()
    const password = document.getElementById('registerPassword').value

    const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: fullName
            }
        }
    })

    if (error) {
        showAuthMessage(error.message)
        return
    }

    if (data.user && data.session) {
        const { error: profileError } = await db
            .from('profiles')
            .upsert({
                id: data.user.id,
                full_name: fullName,
                role: 'user'
            })

        if (profileError) {
            showAuthMessage(profileError.message)
            return
        }

        await initializeApp(data.user)
        return
    }

    showAuthMessage(
        'Бүртгэл амжилттай. И-мэйл баталгаажуулалт шаардлагатай бол и-мэйлээ шалгана уу.',
        'success'
    )

    registerForm.reset()
})

loginForm.addEventListener('submit', async event => {
    event.preventDefault()

    clearAuthMessage()

    const email = document.getElementById('loginEmail').value.trim()
    const password = document.getElementById('loginPassword').value

    const { data, error } = await db.auth.signInWithPassword({
        email,
        password
    })

    if (error) {
        showAuthMessage('И-мэйл эсвэл нууц үг буруу байна.')
        return
    }

    await initializeApp(data.user)
})

logoutBtn.addEventListener('click', async () => {
    await db.auth.signOut()

    currentUser = null
    currentProfile = null
    cars = []
    rentals = []

    appPage.classList.add('d-none')
    authPage.classList.remove('d-none')

    loginForm.reset()
    showLogin()
})

async function ensureProfile() {
    const { data, error } = await db
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle()

    if (error) {
        throw error
    }

    if (data) {
        currentProfile = data
        return
    }

    const fullName =
        currentUser.user_metadata?.full_name ||
        currentUser.email?.split('@')[0] ||
        'Хэрэглэгч'

    const { data: newProfile, error: insertError } = await db
        .from('profiles')
        .insert({
            id: currentUser.id,
            full_name: fullName,
            role: 'user'
        })
        .select()
        .single()

    if (insertError) {
        throw insertError
    }

    currentProfile = newProfile
}

async function initializeApp(user) {
    try {
        currentUser = user

        await ensureProfile()

        authPage.classList.add('d-none')
        appPage.classList.remove('d-none')

        document.getElementById('sidebarUserName').textContent =
            currentProfile.full_name

        document.getElementById('sidebarUserEmail').textContent =
            currentUser.email

        document.getElementById('topUserName').textContent =
            currentProfile.full_name

        const adminElements = document.querySelectorAll('.admin-only')

        adminElements.forEach(element => {
            element.style.display =
                currentProfile.role === 'admin' ? '' : 'none'
        })

        setCurrentDate()
        await loadData()
        switchPage('dashboard')
    } catch (error) {
        console.error(error)
        showToast(error.message || 'Систем ачаалахад алдаа гарлаа.', 'danger')
    }
}

function setCurrentDate() {
    document.getElementById('currentDate').textContent =
        new Date().toLocaleDateString('mn-MN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })
}

async function loadData() {
    await Promise.all([
        loadCars(),
        loadRentals()
    ])

    renderEverything()
}

async function loadCars() {
    const { data, error } = await db
        .from('cars')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        throw error
    }

    cars = data || []
}

async function loadRentals() {
    const { data, error } = await db
        .from('rentals')
        .select(`
            *,
            cars (
                id,
                brand,
                model,
                category,
                plate_number,
                price_per_day,
                image_url
            )
        `)
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })

    if (error) {
        throw error
    }

    rentals = data || []
}

function renderEverything() {
    renderStats()
    renderFeaturedCars()
    renderCars()
    renderRentals()
    renderRecentRentals()
    renderManagement()
    renderChart()
}

function renderStats() {
    const available = cars.filter(car => car.status === 'available').length

    const active = rentals.filter(rental =>
        rental.status === 'active'
    ).length

    const totalSpent = rentals
        .filter(rental => rental.status !== 'cancelled')
        .reduce((sum, rental) => sum + Number(rental.total_price), 0)

    document.getElementById('totalCars').textContent = cars.length
    document.getElementById('availableCars').textContent = available
    document.getElementById('activeRentals').textContent = active
    document.getElementById('totalSpent').textContent =
        formatMoney(totalSpent)
}

function carImage(car) {
    return car.image_url ||
        'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1000&q=80'
}

function renderFeaturedCars() {
    const container = document.getElementById('featuredCars')

    const featured = cars
        .filter(car => car.status === 'available')
        .slice(0, 4)

    if (!featured.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-car"></i>
                <h5>Сул машин алга</h5>
                <p>Одоогоор түрээслэх боломжтой машин байхгүй байна.</p>
            </div>
        `
        return
    }

    container.innerHTML = featured.map(car => `
        <div class="featured-card">
            <img src="${escapeHTML(carImage(car))}" alt="${escapeHTML(car.brand)}">
            <div class="featured-card-content">
                <h6>${escapeHTML(car.brand)} ${escapeHTML(car.model)}</h6>
                <small>
                    ${escapeHTML(car.category)} ·
                    ${formatMoney(car.price_per_day)} / өдөр
                </small>
            </div>
        </div>
    `).join('')
}

function renderCars() {
    const container = document.getElementById('carsGrid')

    const search =
        document.getElementById('carSearch').value.toLowerCase().trim()

    const category =
        document.getElementById('categoryFilter').value

    const status =
        document.getElementById('statusFilter').value

    const filtered = cars.filter(car => {
        const text =
            `${car.brand} ${car.model} ${car.plate_number}`.toLowerCase()

        const matchesSearch = text.includes(search)

        const matchesCategory =
            category === 'all' || car.category === category

        const matchesStatus =
            status === 'all' || car.status === status

        return matchesSearch && matchesCategory && matchesStatus
    })

    if (!filtered.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-magnifying-glass"></i>
                <h5>Машин олдсонгүй</h5>
                <p>Хайлтын нөхцөлөө өөрчилж үзнэ үү.</p>
            </div>
        `
        return
    }

    container.innerHTML = filtered.map(car => `
        <div class="car-card">
            <div class="car-image">
                <img
                    src="${escapeHTML(carImage(car))}"
                    alt="${escapeHTML(car.brand)} ${escapeHTML(car.model)}"
                >

                <span class="car-status ${
                    car.status === 'available'
                        ? 'status-available'
                        : 'status-rented'
                }">
                    ${car.status === 'available' ? 'Сул' : 'Түрээстэй'}
                </span>
            </div>

            <div class="car-content">
                <h5>${escapeHTML(car.brand)} ${escapeHTML(car.model)}</h5>
                <span class="car-category">${escapeHTML(car.category)}</span>

                <div class="car-info">
                    <span>
                        <i class="fa-regular fa-calendar"></i>
                        ${car.year}
                    </span>

                    <span>
                        <i class="fa-solid fa-id-card"></i>
                        ${escapeHTML(car.plate_number)}
                    </span>
                </div>

                <div class="car-footer">
                    <div class="car-price">
                        <strong>${formatMoney(car.price_per_day)}</strong>
                        <small>/ өдөр</small>
                    </div>

                    <button
                        class="rent-btn"
                        onclick="openRentModal('${car.id}')"
                        ${car.status !== 'available' ? 'disabled' : ''}
                    >
                        ${
                            car.status === 'available'
                                ? 'Түрээслэх'
                                : 'Боломжгүй'
                        }
                    </button>
                </div>
            </div>
        </div>
    `).join('')
}

document.getElementById('carSearch').addEventListener('input', renderCars)
document.getElementById('categoryFilter').addEventListener('change', renderCars)
document.getElementById('statusFilter').addEventListener('change', renderCars)

window.openRentModal = function(carId) {
    const car = cars.find(item => item.id === carId)

    if (!car || car.status !== 'available') {
        showToast('Энэ машин түрээслэх боломжгүй байна.', 'danger')
        return
    }

    selectedCar = car

    document.getElementById('rentCarId').value = car.id
    document.getElementById('rentCarName').textContent =
        `${car.brand} ${car.model}`

    document.getElementById('dailyPrice').textContent =
        formatMoney(car.price_per_day)

    const today = new Date()
    const todayString = toDateInputValue(today)

    document.getElementById('startDate').min = todayString
    document.getElementById('endDate').min = todayString

    document.getElementById('startDate').value = todayString
    document.getElementById('endDate').value = todayString

    calculateRentalPrice()
    rentModal.show()
}

function toDateInputValue(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
}

function calculateRentalPrice() {
    if (!selectedCar) return

    const startValue = document.getElementById('startDate').value
    const endValue = document.getElementById('endDate').value

    if (!startValue || !endValue) {
        document.getElementById('totalDays').textContent = '0'
        document.getElementById('rentTotalPrice').textContent = '₮0'
        return
    }

    const start = new Date(`${startValue}T00:00:00`)
    const end = new Date(`${endValue}T00:00:00`)

    if (end < start) {
        document.getElementById('totalDays').textContent = '0'
        document.getElementById('rentTotalPrice').textContent = '₮0'
        return
    }

    const difference = end.getTime() - start.getTime()
    const days = Math.floor(difference / 86400000) + 1
    const total = days * Number(selectedCar.price_per_day)

    document.getElementById('totalDays').textContent = days
    document.getElementById('rentTotalPrice').textContent =
        formatMoney(total)
}

document.getElementById('startDate').addEventListener('change', () => {
    const startDate = document.getElementById('startDate').value

    document.getElementById('endDate').min = startDate

    if (document.getElementById('endDate').value < startDate) {
        document.getElementById('endDate').value = startDate
    }

    calculateRentalPrice()
})

document.getElementById('endDate')
    .addEventListener('change', calculateRentalPrice)

document.getElementById('rentForm').addEventListener('submit', async event => {
    event.preventDefault()

    if (!selectedCar || !currentUser) return

    const startDate = document.getElementById('startDate').value
    const endDate = document.getElementById('endDate').value

    const start = new Date(`${startDate}T00:00:00`)
    const end = new Date(`${endDate}T00:00:00`)

    if (end < start) {
        showToast(
            'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.',
            'danger'
        )
        return
    }

    const days =
        Math.floor((end.getTime() - start.getTime()) / 86400000) + 1

    const totalPrice =
        days * Number(selectedCar.price_per_day)

    const { error: rentalError } = await db
        .from('rentals')
        .insert({
            user_id: currentUser.id,
            car_id: selectedCar.id,
            start_date: startDate,
            end_date: endDate,
            total_days: days,
            total_price: totalPrice,
            status: 'active'
        })

    if (rentalError) {
        showToast(rentalError.message, 'danger')
        return
    }

    const { error: carError } = await db
        .from('cars')
        .update({
            status: 'rented'
        })
        .eq('id', selectedCar.id)

    if (carError) {
        showToast(carError.message, 'danger')
        return
    }

    rentModal.hide()

    selectedCar = null

    showToast('Машин амжилттай түрээслэгдлээ.')

    await loadData()
})

function rentalStatusBadge(status) {
    if (status === 'active') {
        return `<span class="status-badge status-active">Идэвхтэй</span>`
    }

    if (status === 'completed') {
        return `<span class="status-badge status-completed">Дууссан</span>`
    }

    return `<span class="status-badge status-cancelled">Цуцлагдсан</span>`
}

function renderRentals() {
    const tbody = document.getElementById('rentalsTableBody')

    if (!rentals.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fa-regular fa-calendar"></i>
                        <h5>Түрээсийн мэдээлэл алга</h5>
                        <p>Та одоогоор машин түрээслээгүй байна.</p>
                    </div>
                </td>
            </tr>
        `
        return
    }

    tbody.innerHTML = rentals.map(rental => {
        const car = rental.cars || {}

        return `
            <tr>
                <td>
                    <div class="table-car">
                        <img
                            src="${escapeHTML(car.image_url || carImage(car))}"
                            alt="car"
                        >
                        <div>
                            <strong>
                                ${escapeHTML(car.brand || '')}
                                ${escapeHTML(car.model || '')}
                            </strong>
                            <small>
                                ${escapeHTML(car.plate_number || '')}
                            </small>
                        </div>
                    </div>
                </td>

                <td>${formatDate(rental.start_date)}</td>
                <td>${formatDate(rental.end_date)}</td>
                <td>${rental.total_days}</td>
                <td>${formatMoney(rental.total_price)}</td>
                <td>${rentalStatusBadge(rental.status)}</td>

                <td>
                    ${
                        rental.status === 'active'
                            ? `
                                <button
                                    class="action-btn"
                                    title="Дуусгах"
                                    onclick="completeRental('${rental.id}', '${rental.car_id}')"
                                >
                                    <i class="fa-solid fa-check"></i>
                                </button>

                                <button
                                    class="action-btn delete"
                                    title="Цуцлах"
                                    onclick="cancelRental('${rental.id}', '${rental.car_id}')"
                                >
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            `
                            : '-'
                    }
                </td>
            </tr>
        `
    }).join('')
}

function renderRecentRentals() {
    const tbody = document.getElementById('recentRentalsBody')

    const recent = rentals.slice(0, 5)

    if (!recent.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-secondary py-4">
                    Түрээсийн мэдээлэл алга.
                </td>
            </tr>
        `
        return
    }

    tbody.innerHTML = recent.map(rental => {
        const car = rental.cars || {}

        return `
            <tr>
                <td>
                    <strong>
                        ${escapeHTML(car.brand || '')}
                        ${escapeHTML(car.model || '')}
                    </strong>
                </td>
                <td>${formatDate(rental.start_date)}</td>
                <td>${formatDate(rental.end_date)}</td>
                <td>${formatMoney(rental.total_price)}</td>
                <td>${rentalStatusBadge(rental.status)}</td>
            </tr>
        `
    }).join('')
}

window.completeRental = async function(rentalId, carId) {
    const confirmed = confirm('Энэ түрээсийг дуусгах уу?')

    if (!confirmed) return

    const { error } = await db
        .from('rentals')
        .update({
            status: 'completed'
        })
        .eq('id', rentalId)

    if (error) {
        showToast(error.message, 'danger')
        return
    }

    await db
        .from('cars')
        .update({
            status: 'available'
        })
        .eq('id', carId)

    showToast('Түрээс амжилттай дууслаа.')

    await loadData()
}

window.cancelRental = async function(rentalId, carId) {
    const confirmed = confirm('Энэ түрээсийг цуцлах уу?')

    if (!confirmed) return

    const { error } = await db
        .from('rentals')
        .update({
            status: 'cancelled'
        })
        .eq('id', rentalId)

    if (error) {
        showToast(error.message, 'danger')
        return
    }

    await db
        .from('cars')
        .update({
            status: 'available'
        })
        .eq('id', carId)

    showToast('Түрээс цуцлагдлаа.', 'warning')

    await loadData()
}

function renderManagement() {
    const tbody = document.getElementById('managementTableBody')

    if (currentProfile?.role !== 'admin') {
        tbody.innerHTML = ''
        return
    }

    if (!cars.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4">
                    Машины мэдээлэл алга.
                </td>
            </tr>
        `
        return
    }

    tbody.innerHTML = cars.map(car => `
        <tr>
            <td>
                <div class="table-car">
                    <img
                        src="${escapeHTML(carImage(car))}"
                        alt="${escapeHTML(car.brand)}"
                    >
                    <div>
                        <strong>
                            ${escapeHTML(car.brand)}
                            ${escapeHTML(car.model)}
                        </strong>
                        <small>${car.year}</small>
                    </div>
                </div>
            </td>

            <td>${escapeHTML(car.category)}</td>
            <td>${escapeHTML(car.plate_number)}</td>
            <td>${formatMoney(car.price_per_day)}</td>

            <td>
                <span class="status-badge ${
                    car.status === 'available'
                        ? 'status-completed'
                        : 'status-cancelled'
                }">
                    ${car.status === 'available' ? 'Сул' : 'Түрээстэй'}
                </span>
            </td>

            <td>
                <button
                    class="action-btn"
                    onclick="editCar('${car.id}')"
                >
                    <i class="fa-solid fa-pen"></i>
                </button>

                <button
                    class="action-btn delete"
                    onclick="deleteCar('${car.id}')"
                >
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('')
}

document.getElementById('addCarBtn').addEventListener('click', () => {
    document.getElementById('carForm').reset()
    document.getElementById('editCarId').value = ''
    document.getElementById('carModalTitle').textContent = 'Машин нэмэх'
    carModal.show()
})

window.editCar = function(carId) {
    const car = cars.find(item => item.id === carId)

    if (!car) return

    document.getElementById('editCarId').value = car.id
    document.getElementById('carBrand').value = car.brand
    document.getElementById('carModel').value = car.model
    document.getElementById('carCategory').value = car.category
    document.getElementById('carPlate').value = car.plate_number
    document.getElementById('carYear').value = car.year
    document.getElementById('carPrice').value = car.price_per_day
    document.getElementById('carImage').value = car.image_url || ''

    document.getElementById('carModalTitle').textContent = 'Машин засах'

    carModal.show()
}

document.getElementById('carForm').addEventListener('submit', async event => {
    event.preventDefault()

    if (currentProfile?.role !== 'admin') {
        showToast('Admin эрх шаардлагатай.', 'danger')
        return
    }

    const carId = document.getElementById('editCarId').value

    const payload = {
        brand: document.getElementById('carBrand').value.trim(),
        model: document.getElementById('carModel').value.trim(),
        category: document.getElementById('carCategory').value,
        plate_number: document.getElementById('carPlate').value.trim(),
        year: Number(document.getElementById('carYear').value),
        price_per_day: Number(document.getElementById('carPrice').value),
        image_url: document.getElementById('carImage').value.trim() || null
    }

    let result

    if (carId) {
        result = await db
            .from('cars')
            .update(payload)
            .eq('id', carId)
    } else {
        result = await db
            .from('cars')
            .insert(payload)
    }

    if (result.error) {
        showToast(result.error.message, 'danger')
        return
    }

    carModal.hide()

    showToast(
        carId
            ? 'Машины мэдээлэл шинэчлэгдлээ.'
            : 'Шинэ машин нэмэгдлээ.'
    )

    await loadData()
})

window.deleteCar = async function(carId) {
    if (currentProfile?.role !== 'admin') {
        showToast('Admin эрх шаардлагатай.', 'danger')
        return
    }

    const car = cars.find(item => item.id === carId)

    if (!car) return

    if (car.status === 'rented') {
        showToast('Түрээстэй машиныг устгах боломжгүй.', 'danger')
        return
    }

    const confirmed = confirm(
        `${car.brand} ${car.model} машиныг устгах уу?`
    )

    if (!confirmed) return

    const { error } = await db
        .from('cars')
        .delete()
        .eq('id', carId)

    if (error) {
        showToast(error.message, 'danger')
        return
    }

    showToast('Машин устгагдлаа.', 'warning')

    await loadData()
}

function renderChart() {
    const canvas = document.getElementById('rentalChart')

    const active =
        rentals.filter(item => item.status === 'active').length

    const completed =
        rentals.filter(item => item.status === 'completed').length

    const cancelled =
        rentals.filter(item => item.status === 'cancelled').length

    if (rentalChart) {
        rentalChart.destroy()
    }

    rentalChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Идэвхтэй', 'Дууссан', 'Цуцлагдсан'],
            datasets: [{
                data: [active, completed, cancelled],
                backgroundColor: [
                    '#2563eb',
                    '#16a34a',
                    '#dc2626'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 18,
                        font: {
                            size: 10
                        }
                    }
                }
            }
        }
    })
}

const pageTitles = {
    dashboard: 'Хяналтын самбар',
    cars: 'Машинууд',
    rentals: 'Миний түрээс',
    management: 'Машины удирдлага'
}

function switchPage(page) {
    if (
        page === 'management' &&
        currentProfile?.role !== 'admin'
    ) {
        return
    }

    document.querySelectorAll('.content-page').forEach(section => {
        section.classList.add('d-none')
    })

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active')
    })

    const pageElement = document.getElementById(`${page}Page`)

    if (pageElement) {
        pageElement.classList.remove('d-none')
    }

    const nav = document.querySelector(
        `.nav-item[data-page="${page}"]`
    )

    if (nav) {
        nav.classList.add('active')
    }

    document.getElementById('pageTitle').textContent =
        pageTitles[page] || 'DriveRent'

    if (page === 'dashboard') {
        renderStats()
        renderFeaturedCars()
        renderRecentRentals()
        renderChart()
    }

    if (page === 'cars') {
        renderCars()
    }

    if (page === 'rentals') {
        renderRentals()
    }

    if (page === 'management') {
        renderManagement()
    }
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        switchPage(item.dataset.page)
    })
})

document.getElementById('browseCarsBtn')
    .addEventListener('click', () => switchPage('cars'))

document.getElementById('viewAllCarsBtn')
    .addEventListener('click', () => switchPage('cars'))

async function restoreSession() {
    const {
        data: { session }
    } = await db.auth.getSession()

    if (session?.user) {
        await initializeApp(session.user)
    } else {
        authPage.classList.remove('d-none')
        appPage.classList.add('d-none')
    }
}

db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
        authPage.classList.remove('d-none')
        appPage.classList.add('d-none')
    }
})

restoreSession()