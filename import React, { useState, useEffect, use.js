import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { 
    getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, query, Timestamp, setLogLevel, deleteDoc, getDocs, where, writeBatch
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Plus, Pill, History, BarChart2, Stethoscope, Package, ChevronLeft, Users, User, Calendar, Droplets, HeartPulse, FileText, Bell, Upload, Trash2, AlertTriangle } from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-health-dashboard';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Main App Component ---
export default function App() {
    // --- State Management ---
    const [view, setView] = useState('dashboard');
    const [profiles, setProfiles] = useState([]);
    const [activeProfileId, setActiveProfileId] = useState(null);
    const [medicines, setMedicines] = useState([]);
    const [logs, setLogs] = useState([]);
    const [appointments, setAppointments] = useState([]);
    const [bloodPressure, setBloodPressure] = useState([]);
    const [bloodSugar, setBloodSugar] = useState([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [storage, setStorage] = useState(null);
    const [userId, setUserId] = useState(null);
    const [error, setError] = useState(null);

    // --- Firebase Initialization ---
    useEffect(() => {
        try {
            setLogLevel('debug');
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            const firebaseStorage = getStorage(app);
            setDb(firestoreDb);
            setAuth(firebaseAuth);
            setStorage(firebaseStorage);

            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                } else {
                    try {
                        if (initialAuthToken) await signInWithCustomToken(firebaseAuth, initialAuthToken);
                        else await signInAnonymously(firebaseAuth);
                    } catch (authError) {
                        console.error("Authentication Error:", authError);
                        setError("Failed to authenticate.");
                        setIsLoading(false);
                    }
                }
            });
            return () => unsubscribe();
        } catch (e) {
            console.error("Firebase Init Error:", e);
            setError("Could not initialize the application.");
            setIsLoading(false);
        }
    }, []);

    // --- Profile Fetching & Management ---
    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        const profilesPath = `/artifacts/${appId}/users/${userId}/profiles`;
        const q = query(collection(db, profilesPath));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const profilesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setProfiles(profilesData);
            if (!activeProfileId && profilesData.length > 0) {
                setActiveProfileId(profilesData[0].id);
            } else if (profilesData.findIndex(p => p.id === activeProfileId) === -1 && profilesData.length > 0) {
                // If active profile was deleted, switch to the first available
                setActiveProfileId(profilesData[0].id);
            } else if (profilesData.length === 0) {
                setActiveProfileId(null);
            }
            setIsLoading(false);
        }, (err) => {
            console.error("Error fetching profiles:", err);
            setError("Could not load profiles.");
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [isAuthReady, db, userId]);

    // --- Data Fetching for Active Profile ---
    useEffect(() => {
        if (!activeProfileId || !db || !userId) {
            const resetState = [setMedicines, setLogs, setAppointments, setBloodPressure, setBloodSugar];
            resetState.forEach(setter => setter([]));
            return;
        };

        const collectionsToFetch = [
            { name: 'medicines', setter: setMedicines },
            { name: 'medicineLogs', setter: setLogs },
            { name: 'appointments', setter: setAppointments },
            { name: 'bloodPressureReadings', setter: setBloodPressure },
            { name: 'bloodSugarReadings', setter: setBloodSugar },
        ];

        const unsubscribers = collectionsToFetch.map(({ name, setter }) => {
            const dataPath = `/artifacts/${appId}/users/${userId}/profiles/${activeProfileId}/${name}`;
            const q = query(collection(db, dataPath));
            return onSnapshot(q, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setter(data);
            }, (err) => console.error(`Error fetching ${name}:`, err));
        });

        return () => unsubscribers.forEach(unsub => unsub());
    }, [activeProfileId, db, userId]);
    
    // --- CRUD Handlers ---
    const handleAddOrUpdate = async (collectionName, data, id = null) => {
        if (!db || !userId || !activeProfileId) return;
        const path = `/artifacts/${appId}/users/${userId}/profiles/${activeProfileId}/${collectionName}`;
        try {
            if (id) {
                await updateDoc(doc(db, path, id), data);
            } else {
                await addDoc(collection(db, path), { ...data, createdAt: Timestamp.now() });
            }
            setView('dashboard'); // Go back to dashboard after add/update
        } catch (e) {
            console.error(`Error saving to ${collectionName}:`, e);
            setError(`Failed to save ${collectionName.slice(0, -1)}.`);
        }
    };
    
    const handleTakeDose = async (med) => {
        if (!db || !userId || !activeProfileId || med.stock <= 0) return;
        try {
            const medRef = doc(db, `/artifacts/${appId}/users/${userId}/profiles/${activeProfileId}/medicines`, med.id);
            await updateDoc(medRef, { stock: med.stock - 1 });
            await addDoc(collection(db, `/artifacts/${appId}/users/${userId}/profiles/${activeProfileId}/medicineLogs`), {
                medicineId: med.id,
                medicineName: med.name,
                takenAt: Timestamp.now()
            });
        } catch (e) { console.error("Error taking dose:", e); }
    };

    const handleProfileChange = (profileId) => {
        setActiveProfileId(profileId);
        setView('dashboard');
    };

    const handleAddProfile = async (profileName, relationship) => {
        if (!db || !userId || profiles.length >= 10) {
            setError("You can add a maximum of 10 profiles.");
            return;
        }
        const path = `/artifacts/${appId}/users/${userId}/profiles`;
        try {
            const newProfile = await addDoc(collection(db, path), { name: profileName, relationship });
            setActiveProfileId(newProfile.id);
            setView('dashboard');
        } catch (e) { console.error("Error adding profile:", e); }
    };

    const handleDeleteProfile = async (profileIdToDelete) => {
        if (!db || !userId) return;
        
        try {
            const collectionsToDelete = ['medicines', 'medicineLogs', 'appointments', 'bloodPressureReadings', 'bloodSugarReadings'];
            const batch = writeBatch(db);

            for (const coll of collectionsToDelete) {
                const collPath = `/artifacts/${appId}/users/${userId}/profiles/${profileIdToDelete}/${coll}`;
                const snapshot = await getDocs(query(collection(db, collPath)));
                snapshot.docs.forEach(doc => batch.delete(doc.ref));
            }

            const profileDocRef = doc(db, `/artifacts/${appId}/users/${userId}/profiles`, profileIdToDelete);
            batch.delete(profileDocRef);

            await batch.commit();
            
            // Active profile will be updated by the onSnapshot listener in the useEffect hook
            setView('dashboard');
        } catch (e) {
            console.error("Error deleting profile:", e);
            setError("Failed to delete profile.");
        }
    };

    const activeProfile = useMemo(() => profiles.find(p => p.id === activeProfileId), [profiles, activeProfileId]);

    // --- Render Logic ---
    const renderView = () => {
        if (!activeProfileId && profiles.length > 0) return <div className="text-center p-8">Loading profile...</div>
        if (!activeProfileId && profiles.length === 0 && !isLoading) return <ProfileManagement profiles={profiles} onAddProfile={handleAddProfile} />;

        switch (view) {
            case 'addMedicine': return <AddMedicineForm onAdd={(med) => handleAddOrUpdate('medicines', med)} onBack={() => setView('dashboard')} storage={storage} userId={userId} appId={appId} profileId={activeProfileId} />;
            case 'history': return <HistoryView logs={logs} onBack={() => setView('dashboard')} />;
            case 'profiles': return <ProfileManagement profiles={profiles} onAddProfile={handleAddProfile} onDeleteProfile={handleDeleteProfile} />;
            case 'appointments': return <AppointmentView appointments={appointments} onSave={(apt) => handleAddOrUpdate('appointments', apt)} onBack={() => setView('dashboard')} />;
            case 'healthMetrics': return <HealthMetricsView bpData={bloodPressure} bsData={bloodSugar} onSaveBP={(data) => handleAddOrUpdate('bloodPressureReadings', data)} onSaveBS={(data) => handleAddOrUpdate('bloodSugarReadings', data)} onBack={() => setView('dashboard')} />;
            case 'export': return <ExportView profile={activeProfile} medicines={medicines} logs={logs} appointments={appointments} bpData={bloodPressure} bsData={bloodSugar} onBack={() => setView('dashboard')} />;
            default: return <Dashboard medicines={medicines} onTakeDose={handleTakeDose} appointments={appointments} />;
        }
    };

    if (isLoading) return <div className="bg-gray-900 text-white flex items-center justify-center h-screen font-sans"><div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-cyan-500"></div></div>;
    
    return (
        <div className="bg-gray-900 text-gray-200 min-h-screen font-sans p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                <Header userId={userId} profiles={profiles} activeProfile={activeProfile} onProfileChange={handleProfileChange} />
                <main className="mt-8">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                        <h1 className="text-3xl font-bold text-white tracking-wider">
                            {activeProfile ? `${activeProfile.name}'s Dashboard` : 'MediTrack'}
                        </h1>
                        {activeProfile && <Navigation onViewChange={setView} currentView={view} />}
                    </div>
                    {error && <div className="bg-red-800/80 border border-red-600 text-white p-4 rounded-lg mb-6 flex items-center gap-4"><AlertTriangle/><p>{error}</p><button onClick={() => setError(null)} className="ml-auto font-bold">X</button></div>}
                     {renderView()}
                </main>
                 <ReminderSystem medicines={medicines} onTakeDose={handleTakeDose} />
            </div>
        </div>
    );
}

// --- Components ---

const Header = ({ userId, profiles, activeProfile, onProfileChange }) => (
    <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-gray-700 gap-4">
        <div className="flex items-center space-x-3">
            <Pill className="text-cyan-400 w-8 h-8" />
            <span className="text-2xl font-semibold text-white">MediTrack</span>
        </div>
        <div className="flex items-center gap-4">
            {profiles.length > 0 && activeProfile && (
                <select 
                    value={activeProfile.id} 
                    onChange={(e) => onProfileChange(e.target.value)}
                    className="bg-gray-700 border border-gray-600 text-white rounded-lg p-2 focus:ring-2 focus:ring-cyan-500"
                >
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            )}
            {userId && <div className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">UID: {userId.substring(0,8)}...</div>}
        </div>
    </header>
);

const Navigation = ({ onViewChange, currentView }) => {
    const navItems = [
        { id: 'dashboard', icon: BarChart2, label: 'Dashboard' },
        { id: 'addMedicine', icon: Plus, label: 'Add Med' },
        { id: 'history', icon: History, label: 'History' },
        { id: 'appointments', icon: Calendar, label: 'Appts' },
        { id: 'healthMetrics', icon: HeartPulse, label: 'Vitals' },
        { id: 'profiles', icon: Users, label: 'Profiles' },
        { id: 'export', icon: FileText, label: 'Export' },
    ];
    return (
        <nav className="bg-gray-800 p-2 rounded-lg shadow-lg">
            <ul className="flex items-center space-x-1 sm:space-x-2">
                {navItems.map(item => (
                    <li key={item.id}>
                        <button onClick={() => onViewChange(item.id)} className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 ease-in-out ${currentView === item.id ? 'bg-cyan-500 text-white shadow-cyan-500/30 shadow-lg' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}>
                            <item.icon className="w-5 h-5" />
                            <span className="hidden md:inline">{item.label}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
};

const Dashboard = ({ medicines, onTakeDose, appointments }) => {
    const upcomingAppointment = useMemo(() => {
        const now = new Date();
        return appointments
            .filter(a => a.date?.toDate() > now)
            .sort((a, b) => a.date.toDate() - b.date.toDate())[0];
    }, [appointments]);

    return (
        <div>
            {upcomingAppointment && (
                <div className="bg-cyan-800/50 border border-cyan-700 text-cyan-200 p-4 rounded-lg mb-6 flex items-center gap-4">
                    <Calendar className="w-6 h-6"/>
                    <div>
                        <h4 className="font-bold">Upcoming Appointment</h4>
                        <p>With Dr. {upcomingAppointment.doctor} on {upcomingAppointment.date.toDate().toLocaleDateString()} at {upcomingAppointment.date.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                    </div>
                </div>
            )}
            {medicines.length === 0 ? (
                <div className="text-center py-16 px-4 bg-gray-800 rounded-lg"><Pill className="mx-auto h-12 w-12 text-gray-500" /><h3 className="mt-2 text-xl font-medium text-white">No Medications Found</h3><p className="mt-1 text-gray-400">Click on 'Add Med' to get started.</p></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {medicines.map(med => <MedicineCard key={med.id} medicine={med} onTakeDose={onTakeDose} />)}
                </div>
            )}
        </div>
    );
};

const MedicineCard = ({ medicine, onTakeDose }) => {
    const dosageInfo = { 'Once a day': 'bg-green-500', 'Twice a day': 'bg-yellow-500', 'Thrice a day': 'bg-orange-500', 'Once a week': 'bg-purple-500' };
    return (
        <div className="bg-gray-800 rounded-xl shadow-lg overflow-hidden transform hover:-translate-y-1 transition-transform duration-300 border border-gray-700">
            <div className="p-5">
                <div className="flex justify-between items-start">
                    <h3 className="text-xl font-bold text-white truncate">{medicine.name}</h3>
                    <span className={`px-2 py-1 text-xs font-bold text-white rounded-full ${dosageInfo[medicine.dosage] || 'bg-gray-500'}`}>{medicine.dosage}</span>
                </div>
                <div className="flex items-center mt-2 text-gray-400 text-sm"><Stethoscope className="w-4 h-4 mr-2" /><span>Dr. {medicine.doctor}</span></div>
                {medicine.prescriptionUrl && <a href={medicine.prescriptionUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 text-sm hover:underline mt-1 flex items-center"><FileText className="w-4 h-4 mr-1"/> View Prescription</a>}
                <div className="mt-4 flex justify-between items-center">
                    <div className="flex items-center text-cyan-400"><Package className="w-6 h-6 mr-2" /><span className="text-2xl font-semibold">{medicine.stock}</span><span className="text-sm ml-1 text-gray-400">in stock</span></div>
                    <button onClick={() => onTakeDose(medicine)} disabled={medicine.stock <= 0} className="flex items-center justify-center px-4 py-2 bg-cyan-500 text-white font-semibold rounded-lg shadow-md hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all transform hover:scale-105"><Pill className="w-5 h-5 mr-2" /> Take</button>
                </div>
            </div>
        </div>
    );
};

const AddMedicineForm = ({ onAdd, onBack, storage, userId, appId, profileId }) => {
    const [med, setMed] = useState({ name: '', doctor: '', stock: '', dosage: 'Once a day', times: ['08:00'] });
    const [prescriptionFile, setPrescriptionFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        const dosageMap = { 'Once a day': 1, 'Twice a day': 2, 'Thrice a day': 3, 'Once a week': 1 };
        const numTimes = dosageMap[med.dosage] || 1;
        const newTimes = Array.from({ length: numTimes }, (_, i) => med.times[i] || '08:00');
        if (newTimes.length !== med.times.length) {
            setMed(prevMed => ({ ...prevMed, times: newTimes }));
        }
    }, [med.dosage]);

    const handleInputChange = (e) => setMed({...med, [e.target.name]: e.target.value});
    
    const handleTimeChange = (index, value) => {
        const newTimes = [...med.times];
        newTimes[index] = value;
        setMed({...med, times: newTimes});
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!med.name || !med.doctor || !med.stock) return;
        let finalMed = { ...med, stock: Number(med.stock) };

        if (prescriptionFile && storage) {
            setIsUploading(true);
            const filePath = `/artifacts/${appId}/users/${userId}/profiles/${profileId}/prescriptions/${Date.now()}_${prescriptionFile.name}`;
            const storageRef = ref(storage, filePath);
            try {
                const snapshot = await uploadBytes(storageRef, prescriptionFile);
                const downloadURL = await getDownloadURL(snapshot.ref);
                finalMed.prescriptionUrl = downloadURL;
            } catch (error) {
                console.error("Upload failed", error);
                setIsUploading(false);
                return;
            }
        }
        onAdd(finalMed);
        setIsUploading(false);
    };

    return (
        <div className="bg-gray-800 p-8 rounded-lg shadow-2xl max-w-2xl mx-auto border border-gray-700">
            <button onClick={onBack} className="flex items-center mb-6 text-cyan-400 hover:text-cyan-300"><ChevronLeft className="w-5 h-5 mr-1" /> Back</button>
            <form onSubmit={handleSubmit} className="space-y-6">
                <InputField name="name" label="Medicine Name" value={med.name} onChange={handleInputChange} required />
                <InputField name="doctor" label="Doctor's Name" value={med.doctor} onChange={handleInputChange} required />
                <InputField name="stock" label="Total in Stock" type="number" value={med.stock} onChange={handleInputChange} required />
                <SelectField name="dosage" label="Dosage Frequency" value={med.dosage} onChange={handleInputChange} options={['Once a day', 'Twice a day', 'Thrice a day', 'Once a week']} />
                
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Dosage Times</label>
                    {med.times.map((time, index) => <input key={index} type="time" value={time} onChange={(e) => handleTimeChange(index, e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 mb-2"/>)}
                </div>

                <div>
                    <label htmlFor="prescription" className="block text-sm font-medium text-gray-300 mb-2">Upload Prescription (Optional)</label>
                    <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-600 border-dashed rounded-md">
                        <div className="space-y-1 text-center">
                            <Upload className="mx-auto h-12 w-12 text-gray-500"/>
                            <div className="flex text-sm text-gray-400">
                                <label htmlFor="file-upload" className="relative cursor-pointer bg-gray-700 rounded-md font-medium text-cyan-400 hover:text-cyan-300 focus-within:outline-none p-1">
                                    <span>Upload a file</span>
                                    <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={(e) => setPrescriptionFile(e.target.files[0])} />
                                </label>
                                <p className="pl-1">or drag and drop</p>
                            </div>
                            <p className="text-xs text-gray-500">{prescriptionFile ? prescriptionFile.name : 'PNG, JPG, PDF up to 10MB'}</p>
                        </div>
                    </div>
                </div>

                <button type="submit" disabled={isUploading} className="w-full flex justify-center py-3 px-4 rounded-lg shadow-lg text-white bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-500">
                    {isUploading ? 'Uploading...' : 'Add Medication'}
                </button>
            </form>
        </div>
    );
};

const HistoryView = ({ logs, onBack }) => {
    const [timeFilter, setTimeFilter] = useState('year'); // 'day', 'month', 'year'

    const filteredLogs = useMemo(() => {
        const now = new Date();
        let startDate = new Date();
        if (timeFilter === 'day') startDate.setDate(now.getDate() - 1);
        else if (timeFilter === 'month') startDate.setMonth(now.getMonth() - 1);
        else startDate.setFullYear(now.getFullYear() - 1);
        
        return logs
            .filter(log => log.takenAt?.toDate() >= startDate)
            .sort((a, b) => b.takenAt.toDate() - a.takenAt.toDate());
    }, [logs, timeFilter]);

    const pieData = useMemo(() => {
        const counts = filteredLogs.reduce((acc, log) => {
            acc[log.medicineName] = (acc[log.medicineName] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [filteredLogs]);

    const COLORS = ['#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];

    return (
        <div className="bg-gray-800 p-4 sm:p-8 rounded-lg shadow-2xl border border-gray-700">
            <button onClick={onBack} className="flex items-center mb-6 text-cyan-400 hover:text-cyan-300"><ChevronLeft className="w-5 h-5 mr-1" /> Back</button>
            <div className="flex justify-center gap-2 mb-6">
                {['day', 'month', 'year'].map(filter => (
                    <button key={filter} onClick={() => setTimeFilter(filter)} className={`px-4 py-2 rounded-lg text-sm font-semibold ${timeFilter === filter ? 'bg-cyan-500 text-white' : 'bg-gray-700 text-gray-300'}`}>
                        Last {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                ))}
            </div>
            {logs.length === 0 ? <div className="text-center py-16"><History className="mx-auto h-12 w-12 text-gray-500" /><h3 className="mt-2 text-xl font-medium text-white">No History</h3></div> : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div>
                        <h3 className="text-xl font-semibold text-white mb-4">Consumption Chart</h3>
                        <div className="w-full h-80">
                            <ResponsiveContainer>
                                <PieChart>
                                    <Pie data={pieData} cx="50%" cy="50%" labelLine={false} outerRadius="80%" fill="#8884d8" dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                        {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold text-white mb-4">Detailed Log</h3>
                        <div className="max-h-96 overflow-y-auto pr-2 space-y-3">
                            {filteredLogs.map(log => (
                                <div key={log.id} className="bg-gray-700 p-3 rounded-lg flex justify-between items-center">
                                    <span className="font-medium text-white">{log.medicineName}</span>
                                    <span className="text-sm text-gray-400">{log.takenAt.toDate().toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const ProfileManagement = ({ profiles = [], onAddProfile, onDeleteProfile }) => {
    const [name, setName] = useState('');
    const [relationship, setRelationship] = useState('');
    const [confirmingDelete, setConfirmingDelete] = useState(null); // State for confirmation

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name || !relationship) return;
        onAddProfile(name, relationship);
        setName('');
        setRelationship('');
    };

    const handleDeleteClick = (profile) => {
        setConfirmingDelete(profile);
    };

    const confirmDelete = () => {
        if (confirmingDelete) {
            onDeleteProfile(confirmingDelete.id);
            setConfirmingDelete(null);
        }
    };

    return (
        <div className="bg-gray-800 p-8 rounded-lg shadow-2xl max-w-2xl mx-auto border border-gray-700">
            {confirmingDelete && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-gray-900 p-6 rounded-lg shadow-xl border border-red-500">
                        <h3 className="text-lg font-bold text-white">Confirm Deletion</h3>
                        <p className="text-gray-300 mt-2">Are you sure you want to delete the profile for <span className="font-bold">{confirmingDelete.name}</span>? All associated data will be lost forever.</p>
                        <div className="mt-4 flex justify-end gap-3">
                            <button onClick={() => setConfirmingDelete(null)} className="px-4 py-2 rounded bg-gray-600 hover:bg-gray-500 text-white">Cancel</button>
                            <button onClick={confirmDelete} className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-white">Delete</button>
                        </div>
                    </div>
                </div>
            )}
            <h2 className="text-2xl font-bold text-white mb-6">Manage Profiles</h2>
            <form onSubmit={handleSubmit} className="space-y-4 mb-8">
                <InputField label="Profile Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., John Doe" required />
                <InputField label="Relationship" value={relationship} onChange={e => setRelationship(e.target.value)} placeholder="e.g., Self, Spouse, Child" required />
                <button type="submit" disabled={profiles.length >= 10} className="w-full flex justify-center py-2 px-4 rounded-lg text-white bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-500 disabled:cursor-not-allowed">Add Profile</button>
                {profiles.length >= 10 && <p className="text-sm text-yellow-400 text-center">Profile limit of 10 reached.</p>}
            </form>
            <div className="space-y-3">
                <h3 className="text-lg font-semibold text-white">Existing Profiles</h3>
                {profiles.length === 0 ? <p className="text-gray-400">No profiles created yet. Add one above to start.</p> :
                profiles.map(p => (
                    <div key={p.id} className="bg-gray-700 p-3 rounded-lg flex justify-between items-center">
                        <div>
                            <p className="font-medium text-white">{p.name}</p>
                            <p className="text-sm text-gray-400">{p.relationship}</p>
                        </div>
                        <button onClick={() => handleDeleteClick(p)} className="text-red-400 hover:text-red-300 p-2 rounded-full bg-gray-800"><Trash2 className="w-5 h-5"/></button>
                    </div>
                ))}
            </div>
        </div>
    );
};

const AppointmentView = ({ appointments, onSave, onBack }) => {
    const [doctor, setDoctor] = useState('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        const dateTime = new Date(`${date}T${time}`);
        onSave({ doctor, date: Timestamp.fromDate(dateTime) });
        setDoctor(''); setDate(''); setTime('');
    };
    
    const sortedAppointments = useMemo(() => [...appointments].sort((a,b) => a.date?.toDate() - b.date?.toDate()), [appointments]);

    return (
        <div className="bg-gray-800 p-8 rounded-lg shadow-2xl max-w-4xl mx-auto border border-gray-700">
            <button onClick={onBack} className="flex items-center mb-6 text-cyan-400 hover:text-cyan-300"><ChevronLeft className="w-5 h-5 mr-1" /> Back</button>
            <h2 className="text-2xl font-bold text-white mb-6">Doctor Appointments</h2>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 items-end">
                <InputField label="Doctor's Name" value={doctor} onChange={e => setDoctor(e.target.value)} required />
                <InputField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
                <InputField label="Time" type="time" value={time} onChange={e => setTime(e.target.value)} required />
                <button type="submit" className="sm:col-span-3 py-2 px-4 rounded-lg text-white bg-cyan-500 hover:bg-cyan-600">Add Appointment</button>
            </form>
            <div className="space-y-3 max-h-96 overflow-y-auto">
                {sortedAppointments.map(a => (
                    <div key={a.id} className={`p-3 rounded-lg flex justify-between items-center ${a.date?.toDate() < new Date() ? 'bg-gray-700' : 'bg-cyan-900/70'}`}>
                        <div>
                            <p className="font-medium text-white">Dr. {a.doctor}</p>
                            <p className="text-sm text-gray-300">{a.date?.toDate().toLocaleString()}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const HealthMetricsView = ({ bpData, bsData, onSaveBP, onSaveBS, onBack }) => {
    const [bp, setBp] = useState({ systolic: '', diastolic: '' });
    const [bs, setBs] = useState({ value: '', type: 'Fasting' });

    const sortedBp = useMemo(() => [...bpData].sort((a,b) => b.createdAt?.toDate() - a.createdAt?.toDate()), [bpData]);
    const sortedBs = useMemo(() => [...bsData].sort((a,b) => b.createdAt?.toDate() - a.createdAt?.toDate()), [bsData]);
    
    return (
        <div className="bg-gray-800 p-8 rounded-lg shadow-2xl border border-gray-700">
            <button onClick={onBack} className="flex items-center mb-6 text-cyan-400 hover:text-cyan-300"><ChevronLeft className="w-5 h-5 mr-1" /> Back</button>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Blood Pressure */}
                <div className="space-y-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2"><HeartPulse/> Blood Pressure</h3>
                    <form onSubmit={(e) => { e.preventDefault(); onSaveBP(bp); setBp({systolic:'', diastolic:''}); }} className="grid grid-cols-2 gap-4">
                        <InputField label="Systolic" type="number" value={bp.systolic} onChange={e => setBp({...bp, systolic: e.target.value})} required/>
                        <InputField label="Diastolic" type="number" value={bp.diastolic} onChange={e => setBp({...bp, diastolic: e.target.value})} required/>
                        <button type="submit" className="col-span-2 py-2 rounded-lg bg-pink-500 hover:bg-pink-600 text-white">Add BP Reading</button>
                    </form>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                        {sortedBp.map(d => <div key={d.id} className="bg-gray-700 p-2 rounded flex justify-between"><span>{d.systolic}/{d.diastolic} mmHg</span><span className="text-gray-400 text-sm">{d.createdAt?.toDate().toLocaleDateString()}</span></div>)}
                    </div>
                </div>
                {/* Blood Sugar */}
                <div className="space-y-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2"><Droplets/> Blood Sugar</h3>
                    <form onSubmit={(e) => { e.preventDefault(); onSaveBS(bs); setBs({value:'', type:'Fasting'}); }} className="grid grid-cols-2 gap-4">
                        <InputField label="Value (mg/dL)" type="number" value={bs.value} onChange={e => setBs({...bs, value: e.target.value})} required/>
                        <SelectField label="Type" value={bs.type} onChange={e => setBs({...bs, type: e.target.value})} options={['Fasting', 'PP', 'Random']} />
                        <button type="submit" className="col-span-2 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white">Add BS Reading</button>
                    </form>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                        {sortedBs.map(d => <div key={d.id} className="bg-gray-700 p-2 rounded flex justify-between"><span>{d.value} mg/dL ({d.type})</span><span className="text-gray-400 text-sm">{d.createdAt?.toDate().toLocaleDateString()}</span></div>)}
                    </div>
                </div>
            </div>
        </div>
    );
};

const ExportView = ({ profile, medicines, logs, appointments, bpData, bsData, onBack }) => {
    const generatePdf = () => {
        // Access jsPDF from the window object, assuming it's loaded from a CDN
        if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function') {
            console.error("jsPDF library not found. PDF export is disabled.");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        if(!profile) return;
        doc.text(`Health Report for ${profile.name}`, 14, 16);
        doc.setFontSize(10);
        doc.text(`Report Generated: ${new Date().toLocaleDateString()}`, 14, 22);

        // Medications
        doc.autoTable({
            startY: 30,
            head: [['Medication', 'Doctor', 'Dosage']],
            body: medicines.map(m => [m.name, m.doctor, m.dosage]),
            headStyles: { fillColor: [6, 182, 212] }
        });

        // Consumption Log
        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Medication Taken', 'Date & Time']],
            body: logs.slice(0, 20).map(l => [l.medicineName, l.takenAt?.toDate().toLocaleString()]),
            headStyles: { fillColor: [6, 182, 212] }
        });
        
        // Health Vitals
        const vitals = [
            ...bpData.map(d => [`Blood Pressure: ${d.systolic}/${d.diastolic} mmHg`, d.createdAt?.toDate().toLocaleString()]),
            ...bsData.map(d => [`Blood Sugar: ${d.value} mg/dL (${d.type})`, d.createdAt?.toDate().toLocaleString()])
        ].sort((a,b) => new Date(b[1]) - new Date(a[1]));

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Vital Reading', 'Date & Time']],
            body: vitals.slice(0,20),
            headStyles: { fillColor: [139, 92, 246] }
        });

        doc.save(`${profile.name}_Health_Report.pdf`);
    };

    return (
        <div className="bg-gray-800 p-8 rounded-lg shadow-2xl max-w-2xl mx-auto border border-gray-700 text-center">
            <button onClick={onBack} className="flex items-center mb-6 text-cyan-400 hover:text-cyan-300"><ChevronLeft className="w-5 h-5 mr-1" /> Back</button>
            <h2 className="text-2xl font-bold text-white mb-4">Export Report</h2>
            <p className="text-gray-400 mb-6">Generate a PDF summary of {profile?.name}'s health data for doctor visits.</p>
            <button onClick={generatePdf} className="py-3 px-6 rounded-lg text-white bg-cyan-500 hover:bg-cyan-600 font-semibold">Generate and Download PDF</button>
        </div>
    );
};

const ReminderSystem = ({ medicines, onTakeDose }) => {
    const [dueMeds, setDueMeds] = useState([]);
    
    useEffect(() => {
        const checkReminders = () => {
            const now = new Date();
            const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            const due = medicines.filter(med => med.times && med.times.includes(currentTime) && med.stock > 0);
            if (due.length > 0) {
                setDueMeds(prev => [...prev, ...due.filter(d => !prev.find(p => p.id === d.id))]);
            }
        };
        const interval = setInterval(checkReminders, 60000); // Check every minute
        return () => clearInterval(interval);
    }, [medicines]);

    const markAsTaken = (med) => {
        onTakeDose(med);
        setDueMeds(prev => prev.filter(d => d.id !== med.id));
    };

    if (dueMeds.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 w-80 bg-gray-800 border border-cyan-500 rounded-lg shadow-2xl p-4 z-50">
            <h4 className="font-bold text-white flex items-center gap-2"><Bell className="text-cyan-400"/>Medication Reminder</h4>
            <div className="mt-2 space-y-2">
                {dueMeds.map(med => (
                    <div key={med.id} className="bg-gray-700 p-2 rounded-lg">
                        <p className="text-white font-semibold">{med.name}</p>
                        <p className="text-sm text-gray-400">It's time for your dose.</p>
                        <button onClick={() => markAsTaken(med)} className="w-full text-center mt-2 py-1 px-2 rounded bg-cyan-500 hover:bg-cyan-600 text-white text-sm">Mark as Taken</button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- Helper Form Components ---
const InputField = ({ label, ...props }) => (
    <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
        <input {...props} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2 focus:ring-2 focus:ring-cyan-500" />
    </div>
);

const SelectField = ({ label, options, ...props }) => (
    <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
        <select {...props} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2 focus:ring-2 focus:ring-cyan-500">
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
    </div>
);
